import type { Config, Context } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { Receiver } from '@upstash/qstash'
import { Resend } from 'resend'
import webpush from 'web-push'
import { DateTime } from 'luxon'

function escapeHtml(input: string) {
  return input.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]!))
}

export default async (req: Request, context: Context) => {
  const rawBody = await req.text()
  try {
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
    const signature = req.headers.get('Upstash-Signature')
    if (!currentSigningKey || !nextSigningKey || !signature) return new Response('Reminder service not configured', { status: 503 })

    const receiver = new Receiver({ currentSigningKey, nextSigningKey })
    const valid = await receiver.verify({ signature, body: rawBody, url: req.url })
    if (!valid) return new Response('Invalid signature', { status: 401 })

    const { taskId, userId, expectedReminderAt } = JSON.parse(rawBody) as { taskId: number; userId: string; expectedReminderAt: string }
    const db = getDatabase()
    const [task] = await db.sql`SELECT * FROM tasks WHERE id = ${taskId} AND user_id = ${userId}`
    if (!task || task.completed_at) return Response.json({ skipped: true })

    const actualReminder = task.reminder_at_utc ? DateTime.fromJSDate(new Date(String(task.reminder_at_utc))).toUTC().toISO() : null
    const expected = DateTime.fromISO(expectedReminderAt).toUTC().toISO()
    if (!actualReminder || actualReminder !== expected) return Response.json({ skipped: true, reason: 'stale' })

    const [settings] = await db.sql`SELECT * FROM notification_settings WHERE user_id = ${userId}`
    const emailEnabled = settings ? Boolean(settings.email_enabled) : true
    const pushEnabled = settings ? Boolean(settings.push_enabled) : false
    const email = settings?.email || task.user_email
    const timeText = task.task_time ? String(task.task_time).slice(0,5) : ''
    let anyFailure = false

    if (emailEnabled && !task.email_sent_at) {
      const key = process.env.RESEND_API_KEY
      const from = process.env.RESEND_FROM
      if (key && from) {
        const resend = new Resend(key)
        const details = task.details ? `<p style="color:#555">${escapeHtml(String(task.details))}</p>` : ''
        const { error } = await resend.emails.send({
          from,
          to: String(email),
          subject: `${String(task.task_name)} in 10 minutes`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><div style="font-size:13px;color:#777;margin-bottom:20px">TO-DO TODAY</div><h1 style="font-size:24px;margin:0 0 8px">${escapeHtml(String(task.task_name))}</h1><p style="font-size:16px">Scheduled for <strong>${escapeHtml(timeText)}</strong>, in 10 minutes.</p>${details}<p style="margin-top:28px"><a href="${context.site.url}" style="background:#111;color:white;padding:12px 18px;border-radius:10px;text-decoration:none">Open To-do Today</a></p></div>`,
        })
        if (!error) await db.sql`UPDATE tasks SET email_sent_at = NOW() WHERE id = ${taskId}`
        else { console.error('Resend error', error); anyFailure = true }
      } else { console.warn('Email enabled but Resend is not configured'); anyFailure = true }
    }

    if (pushEnabled && !task.push_sent_at) {
      const publicKey = process.env.VAPID_PUBLIC_KEY
      const privateKey = process.env.VAPID_PRIVATE_KEY
      const subject = process.env.VAPID_SUBJECT
      if (publicKey && privateKey && subject) {
        webpush.setVapidDetails(subject, publicKey, privateKey)
        const subscriptions = await db.sql`SELECT id, subscription FROM push_subscriptions WHERE user_id = ${userId}`
        let sent = 0
        for (const row of subscriptions) {
          try {
            await webpush.sendNotification(row.subscription as webpush.PushSubscription, JSON.stringify({
              title: `${String(task.task_name)} in 10 minutes`,
              body: task.details ? String(task.details) : `Scheduled for ${timeText}`,
              url: '/',
              tag: `task-${taskId}`,
            }))
            sent++
          } catch (error: any) {
            if (error?.statusCode === 404 || error?.statusCode === 410) await db.sql`DELETE FROM push_subscriptions WHERE id = ${row.id}`
            else { console.error('Push error', error); anyFailure = true }
          }
        }
        if (sent > 0 || subscriptions.length === 0) await db.sql`UPDATE tasks SET push_sent_at = NOW() WHERE id = ${taskId}`
      } else { console.warn('Push enabled but VAPID is not configured'); anyFailure = true }
    }

    if (anyFailure) return new Response('One or more delivery channels failed', { status: 500 })
    return Response.json({ ok: true })
  } catch (error) {
    console.error(error)
    return new Response('Reminder failed', { status: 500 })
  }
}

export const config: Config = { path: '/api/reminder', method: ['POST'] }
