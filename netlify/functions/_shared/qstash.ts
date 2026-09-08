import { createHmac } from 'node:crypto'
import { Client } from '@upstash/qstash'

function getClient() {
  const token = Netlify.env.get('QSTASH_TOKEN')
  return token ? new Client({ token }) : null
}

export function getReminderWebhookToken() {
  const gmailAppPassword = Netlify.env.get('GMAIL_APP_PASSWORD')
  if (!gmailAppPassword) return null
  return createHmac('sha256', gmailAppPassword)
    .update('todo-today:qstash-reminder:v1')
    .digest('hex')
}

export async function cancelReminder(messageId?: string | null) {
  if (!messageId) return
  const client = getClient()
  if (!client) return
  try {
    await client.messages.cancel(messageId)
  } catch (error) {
    console.warn('Could not cancel QStash reminder', messageId, error)
  }
}

export async function scheduleReminder(taskId: number, reminderAtUtc?: string | null, dueAtUtc?: string | null) {
  const client = getClient()
  const webhookToken = getReminderWebhookToken()
  const siteUrl = Netlify.env.get('URL') || 'https://to-do-ks.netlify.app'

  if (!client || !webhookToken || !reminderAtUtc || !dueAtUtc) return null

  const dueMs = Date.parse(dueAtUtc)
  const reminderMs = Date.parse(reminderAtUtc)
  if (!Number.isFinite(dueMs) || !Number.isFinite(reminderMs) || dueMs <= Date.now()) return null

  const delaySeconds = Math.max(1, Math.ceil((reminderMs - Date.now()) / 1000))

  try {
    const result = await client.publishJSON({
      url: `${siteUrl}/api/reminder`,
      body: { taskId, reminderAtUtc },
      delay: delaySeconds,
      headers: {
        Authorization: `Bearer ${webhookToken}`,
      },
      label: `todo-task-${taskId}`,
    })
    return result.messageId
  } catch (error) {
    console.error('Could not schedule QStash reminder', taskId, error)
    return null
  }
}
