import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import nodemailer from 'nodemailer'
import webpush from 'web-push'
import { getOrCreateVapidConfig } from './_shared/vapid'

function escapeHtml(input: string) {
  return input.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]!))
}

export default async () => {
  const db = getDatabase()
  const gmailUser = Netlify.env.get('GMAIL_USER')
  const gmailAppPassword = Netlify.env.get('GMAIL_APP_PASSWORD')
  const siteUrl = Netlify.env.get('URL') || 'https://to-do-ks.netlify.app'
  const vapid = await getOrCreateVapidConfig()

  const rows = await db.sql`
    SELECT
      t.*,
      COALESCE(s.email_enabled, TRUE) AS email_enabled,
      COALESCE(s.push_enabled, FALSE) AS push_enabled,
      COALESCE(s.email, t.user_email) AS notification_email
    FROM tasks t
    LEFT JOIN notification_settings s ON s.user_id = t.user_id
    WHERE t.completed_at IS NULL
      AND t.reminder_at_utc IS NOT NULL
      AND t.reminder_at_utc <= NOW()
      AND t.due_at_utc >= NOW()
      AND (
        (COALESCE(s.email_enabled, TRUE) = TRUE AND t.email_sent_at IS NULL)
        OR
        (COALESCE(s.push_enabled, FALSE) = TRUE AND t.push_sent_at IS NULL)
      )
    ORDER BY t.reminder_at_utc ASC
    LIMIT 25
  `

  const transporter = gmailUser && gmailAppPassword
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailAppPassword },
      })
    : null

  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

  for (const task of rows) {
    const taskId = Number(task.id)
    const taskName = String(task.task_name)
    const details = task.details ? String(task.details) : ''
    const timeText = task.task_time ? String(task.task_time).slice(0, 5) : ''

    if (Boolean(task.email_enabled) && !task.email_sent_at) {
      if (!transporter || !gmailUser) {
        console.warn('Email reminder pending but Gmail SMTP is not configured')
      } else {
        try {
          const detailsHtml = details ? `<p style="color:#555">${escapeHtml(details)}</p>` : ''
          await transporter.sendMail({
            from: `"To-do Today" <${gmailUser}>`,
            to: String(task.notification_email),
            subject: `${taskName} in 10 minutes`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><div style="font-size:13px;color:#777;margin-bottom:20px">TO-DO TODAY</div><h1 style="font-size:24px;margin:0 0 8px">${escapeHtml(taskName)}</h1><p style="font-size:16px">Scheduled for <strong>${escapeHtml(timeText)}</strong>, in 10 minutes.</p>${detailsHtml}<p style="margin-top:28px"><a href="${siteUrl}" style="background:#111;color:white;padding:12px 18px;border-radius:10px;text-decoration:none">Open To-do Today</a></p></div>`,
          })
          await db.sql`UPDATE tasks SET email_sent_at = NOW() WHERE id = ${taskId} AND email_sent_at IS NULL`
        } catch (error) {
          console.error('Gmail reminder failed', taskId, error)
        }
      }
    }

    if (Boolean(task.push_enabled) && !task.push_sent_at) {
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
          }
        }
      }
      if (sent > 0) {
        await db.sql`UPDATE tasks SET push_sent_at = NOW() WHERE id = ${taskId} AND push_sent_at IS NULL`
      }
    }
  }
}

export const config: Config = {
  schedule: '* * * * *',
}
