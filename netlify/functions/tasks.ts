import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { DateTime } from 'luxon'
import { requireUser, json, errorResponse } from './_shared/auth'
import { cancelReminder, computeTimes, scheduleReminder } from './_shared/reminders'

type TaskBody = {
  taskName?: string
  details?: string
  priority?: 'high' | 'medium' | 'low'
  taskTime?: string | null
  taskDate?: string
  timezone?: string
  completed?: boolean
}

const validPriorities = new Set(['high', 'medium', 'low'])

export default async (req: Request, context: Context) => {
  try {
    const user = await requireUser()
    const db = getDatabase()
    const id = context.params.id ? Number(context.params.id) : null

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const date = url.searchParams.get('date') || DateTime.utc().toISODate()!
      const rows = await db.sql`
        SELECT id, task_date::text AS task_date, task_name, details, priority,
               task_time::text AS task_time, timezone, due_at_utc, reminder_at_utc,
               completed_at, push_sent_at, email_sent_at, created_at
        FROM tasks
        WHERE user_id = ${user.id} AND task_date = ${date}
        ORDER BY completed_at NULLS FIRST, task_time NULLS LAST,
          CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          created_at
      `
      return json({ tasks: rows })
    }

    if (req.method === 'POST') {
      const body = (await req.json()) as TaskBody
      const taskName = body.taskName?.trim()
      const priority = body.priority ?? 'medium'
      const timezone = body.timezone || 'UTC'
      const taskDate = body.taskDate
      const taskTime = body.taskTime || null
      if (!taskName || !taskDate || !validPriorities.has(priority)) return json({ error: 'Invalid task' }, 400)

      const { dueAtUtc, reminderAtUtc } = computeTimes(taskDate, taskTime, timezone, 10)
      const [task] = await db.sql`
        INSERT INTO tasks (user_id, user_email, task_date, task_name, details, priority, task_time, timezone, due_at_utc, reminder_at_utc)
        VALUES (${user.id}, ${user.email}, ${taskDate}, ${taskName}, ${body.details?.trim() || ''}, ${priority}, ${taskTime}, ${timezone}, ${dueAtUtc}, ${reminderAtUtc})
        RETURNING id, task_date::text AS task_date, task_name, details, priority, task_time::text AS task_time, timezone, due_at_utc, reminder_at_utc, completed_at, created_at
      `

      if (reminderAtUtc && dueAtUtc && DateTime.fromISO(dueAtUtc) > DateTime.utc()) {
        const messageId = await scheduleReminder({
          url: `${context.site.url}/api/reminder`, taskId: Number(task.id), userId: user.id, reminderAtUtc,
        })
        if (messageId) await db.sql`UPDATE tasks SET qstash_message_id = ${messageId} WHERE id = ${task.id}`
      }
      return json({ task }, 201)
    }

    if (!id || Number.isNaN(id)) return json({ error: 'Task id required' }, 400)
    const [existing] = await db.sql`SELECT *, task_date::text AS task_date_text, task_time::text AS task_time_text FROM tasks WHERE id = ${id} AND user_id = ${user.id}`
    if (!existing) return json({ error: 'Task not found' }, 404)

    if (req.method === 'PATCH') {
      const body = (await req.json()) as TaskBody

      if (typeof body.completed === 'boolean' && Object.keys(body).length === 1) {
        if (body.completed) await cancelReminder(existing.qstash_message_id as string | null)
        const [task] = await db.sql`
          UPDATE tasks
          SET completed_at = ${body.completed ? new Date().toISOString() : null},
              qstash_message_id = ${body.completed ? null : existing.qstash_message_id},
              updated_at = NOW()
          WHERE id = ${id} AND user_id = ${user.id}
          RETURNING id, task_date::text AS task_date, task_name, details, priority, task_time::text AS task_time, timezone, due_at_utc, reminder_at_utc, completed_at, created_at
        `
        if (!body.completed && existing.reminder_at_utc && existing.due_at_utc && DateTime.fromJSDate(new Date(String(existing.due_at_utc))).toUTC() > DateTime.utc()) {
          const reminderAtUtc = DateTime.fromJSDate(new Date(String(existing.reminder_at_utc))).toUTC().toISO()
          const messageId = await scheduleReminder({ url: `${context.site.url}/api/reminder`, taskId: id, userId: user.id, reminderAtUtc })
          if (messageId) await db.sql`UPDATE tasks SET qstash_message_id = ${messageId} WHERE id = ${id}`
        }
        return json({ task })
      }

      await cancelReminder(existing.qstash_message_id as string | null)
      const taskName = body.taskName?.trim() || String(existing.task_name)
      const details = body.details !== undefined ? body.details.trim() : String(existing.details)
      const priority = body.priority || (existing.priority as 'high' | 'medium' | 'low')
      const taskTime = body.taskTime !== undefined ? (body.taskTime || null) : (existing.task_time_text ? String(existing.task_time_text).slice(0,5) : null)
      const taskDate = body.taskDate || String(existing.task_date_text)
      const timezone = body.timezone || String(existing.timezone)
      const { dueAtUtc, reminderAtUtc } = computeTimes(taskDate, taskTime, timezone, 10)

      const [task] = await db.sql`
        UPDATE tasks SET task_name = ${taskName}, details = ${details}, priority = ${priority}, task_time = ${taskTime},
          task_date = ${taskDate}, timezone = ${timezone}, due_at_utc = ${dueAtUtc}, reminder_at_utc = ${reminderAtUtc},
          qstash_message_id = NULL, push_sent_at = NULL, email_sent_at = NULL, updated_at = NOW()
        WHERE id = ${id} AND user_id = ${user.id}
        RETURNING id, task_date::text AS task_date, task_name, details, priority, task_time::text AS task_time, timezone, due_at_utc, reminder_at_utc, completed_at, created_at
      `
      if (!task.completed_at && reminderAtUtc && dueAtUtc && DateTime.fromISO(dueAtUtc) > DateTime.utc()) {
        const messageId = await scheduleReminder({ url: `${context.site.url}/api/reminder`, taskId: id, userId: user.id, reminderAtUtc })
        if (messageId) await db.sql`UPDATE tasks SET qstash_message_id = ${messageId} WHERE id = ${id}`
      }
      return json({ task })
    }

    if (req.method === 'DELETE') {
      await cancelReminder(existing.qstash_message_id as string | null)
      await db.sql`DELETE FROM tasks WHERE id = ${id} AND user_id = ${user.id}`
      return new Response(null, { status: 204 })
    }

    return new Response('Method not allowed', { status: 405 })
  } catch (error) {
    return errorResponse(error)
  }
}

export const config: Config = {
  path: ['/api/tasks', '/api/tasks/:id'],
  method: ['GET', 'POST', 'PATCH', 'DELETE'],
}
