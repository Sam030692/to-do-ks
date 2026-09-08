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
