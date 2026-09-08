import { Client } from '@upstash/qstash'

function getClient() {
  const token = Netlify.env.get('QSTASH_TOKEN')
  return token ? new Client({ token }) : null
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
  const secret = Netlify.env.get('REMINDER_WEBHOOK_SECRET')
  const siteUrl = Netlify.env.get('URL') || 'https://to-do-ks.netlify.app'

  if (!client || !secret || !reminderAtUtc || !dueAtUtc) return null

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
        Authorization: `Bearer ${secret}`,
      },
      label: `todo-task-${taskId}`,
    })
    return result.messageId
  } catch (error) {
    console.error('Could not schedule QStash reminder', taskId, error)
    return null
  }
}
