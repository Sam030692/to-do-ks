import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import nodemailer from 'nodemailer'
import webpush from 'web-push'
import { getOrCreateVapidConfig } from './_shared/vapid'
import { getReminderWebhookToken } from './_shared/qstash'

function escapeHtml(input: string) {
  return input.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]!))
}

export default async (req: Request) => {
  const webhookToken = getReminderWebhookToken()
  if (!webhookToken || req.headers.get('authorization') !== `Bearer ${webhookToken}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  let payload: { taskId?: number; reminderAtUtc?: string }
  try {
    payload = await req.json() as { taskId?: number; reminderAtUtc?: string }
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const taskId = Number(payload.taskId)
  const expectedReminderAt = payload.reminderAtUtc
  if (!taskId || !expectedReminderAt) return new Response('Invalid reminder', { status: 400 })

  const db = getDatabase()
  const [task] = await db.sql`
    SELECT
      t.*,
      COALESCE(s.email_enabled, TRUE) AS email_enabled,
      COALESCE(s.push_enabled, FALSE) AS push_enabled,
      COALESCE(s.email, t.user_email) AS notification_email
    FROM tasks t
    LEFT JOIN notification_settings s ON s.user_id = t.user_id
    WHERE t.id = ${taskId}
  `

  if (!task || task.completed_at || !task.reminder_at_utc || !task.due_at_utc) {
    return Response.json({ ok: true, skipped: true })
  }

  const storedReminder = new Date(String(task.reminder_at_utc)).toISOString()
  const expectedReminder = new Date(expectedReminderAt).toISOString()
  if (storedReminder !== expectedReminder) {
    return Response.json({ ok: true, skipped: true, reason: 'stale-reminder' })
  }

  if (new Date(String(task.due_at_utc)).getTime() < Date.now()) {
    await db.sql`UPDATE tasks SET qstash_message_id = NULL, updated_at = NOW() WHERE id = ${taskId}`
    return Response.json({ ok: true, skipped: true, reason: 'task-past-due' })
  }

  const gmailUser = Netlify.env.get('GMAIL_USER')
  const gmailAppPassword = Netlify.env.get('GMAIL_APP_PASSWORD')
  const siteUrl = Netlify.env.get('URL') || 'https://to-do-ks.netlify.app'
  const taskName = String(task.task_name)
  const details = task.details ? String(task.details) : ''
  const timeText = task.task_time ? String(task.task_time).slice(0, 5) : ''
  let failed = false

  if (Boolean(task.email_enabled) && !task.email_sent_at) {
    if (!gmailUser || !gmailAppPassword) {
      console.error('Email reminder is enabled but Gmail SMTP is not configured')
      failed = true
    } else {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: gmailUser, pass: gmailAppPassword },
        })
        const subject = `Reminder: ${taskName} at ${timeText}`
        const plainText = [
          `Reminder: ${taskName}`,
          `Scheduled for ${timeText}, in 10 minutes.`,
          details ? `\n${details}` : '',
          `\nOpen To-do Today: ${siteUrl}`,
        ].filter(Boolean).join('\n')
        const detailsHtml = details ? `<p>${escapeHtml(details)}</p>` : ''
        const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#222"><p><strong>Reminder: ${escapeHtml(taskName)}</strong></p><p>Scheduled for ${escapeHtml(timeText)}, in 10 minutes.</p>${detailsHtml}<p><a href="${siteUrl}">Open To-do Today</a></p></div>`

        await transporter.sendMail({
          from: `"To-do Today" <${gmailUser}>`,
          to: String(task.notification_email),
          replyTo: gmailUser,
          subject,
          text: plainText,
          html,
          priority: 'normal',
        })
        await db.sql`UPDATE tasks SET email_sent_at = NOW() WHERE id = ${taskId} AND email_sent_at IS NULL`
      } catch (error) {
        console.error('Gmail reminder failed', taskId, error)
        failed = true
      }
    }
  }

  if (Boolean(task.push_enabled) && !task.push_sent_at) {
    try {
      const vapid = await getOrCreateVapidConfig()
      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
      const subscriptions = await db.sql`SELECT id, subscription FROM push_subscriptions WHERE user_id = ${String(task.user_id)}`
      let sent = 0

      for (const row of subscriptions) {
        try {
          await webpush.sendNotification(
            row.subscription as webpush.PushSubscription,
            JSON.stringify({
              title: `${taskName} in 10 minutes`,
              body: details || `Scheduled for ${timeText}`,
              url: '/',
              tag: `task-${taskId}`,
            }),
          )
          sent++
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await db.sql`DELETE FROM push_subscriptions WHERE id = ${row.id}`
          } else {
            console.error('Push reminder failed', taskId, error)
            failed = true
          }
        }
      }

      if (sent > 0) {
        await db.sql`UPDATE tasks SET push_sent_at = NOW() WHERE id = ${taskId} AND push_sent_at IS NULL`
      }
    } catch (error) {
      console.error('Push reminder setup failed', taskId, error)
      failed = true
    }
  }

  if (failed) {
    return Response.json({ ok: false, retry: true }, { status: 503 })
  }

  await db.sql`UPDATE tasks SET qstash_message_id = NULL, updated_at = NOW() WHERE id = ${taskId}`
  return Response.json({ ok: true })
}

export const config: Config = {
  path: '/api/reminder',
  method: ['POST'],
}
