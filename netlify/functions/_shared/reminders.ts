import { Client } from '@upstash/qstash'
import { DateTime } from 'luxon'

function qstashClient() {
  const token = process.env.QSTASH_TOKEN
  return token ? new Client({ token }) : null
}

export function computeTimes(taskDate: string, taskTime: string | null, timezone: string, reminderMinutes = 10) {
  if (!taskTime) return { dueAtUtc: null, reminderAtUtc: null }
  const local = DateTime.fromISO(`${taskDate}T${taskTime}`, { zone: timezone })
  if (!local.isValid) throw new Error('Invalid task date, time, or timezone')
  return {
    dueAtUtc: local.toUTC().toISO(),
    reminderAtUtc: local.minus({ minutes: reminderMinutes }).toUTC().toISO(),
  }
}

export async function cancelReminder(messageId?: string | null) {
  if (!messageId) return
  const client = qstashClient()
  if (!client) return
  try {
    await client.messages.cancel(messageId)
  } catch (error) {
    console.warn('Could not cancel QStash message', messageId, error)
  }
}

export async function scheduleReminder(args: {
  url: string
  taskId: number
  userId: string
  reminderAtUtc: string | null
}) {
  const { url, taskId, userId, reminderAtUtc } = args
  if (!reminderAtUtc) return null
  const client = qstashClient()
  if (!client) return null

  const reminder = DateTime.fromISO(reminderAtUtc)
  const now = DateTime.utc()
  const seconds = Math.max(1, Math.floor(reminder.diff(now, 'seconds').seconds))
  const result = await client.publishJSON({
    url,
    body: { taskId, userId, expectedReminderAt: reminderAtUtc },
    delay: `${seconds}s`,
    retries: 3,
    label: `todo-task-${taskId}`,
  })
  return result.messageId
}
