import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { requireUser, json, errorResponse } from './_shared/auth'

export default async (req: Request) => {
  try {
    const user = await requireUser()
    const db = getDatabase()
    if (req.method === 'GET') {
      const [settings] = await db.sql`SELECT email, timezone, email_enabled, push_enabled, reminder_minutes FROM notification_settings WHERE user_id = ${user.id}`
      return json({ settings: settings ?? { email: user.email, timezone: 'UTC', email_enabled: true, push_enabled: false, reminder_minutes: 10 } })
    }
    if (req.method === 'PUT') {
      const body = await req.json() as { timezone?: string; emailEnabled?: boolean; pushEnabled?: boolean }
      const [settings] = await db.sql`
        INSERT INTO notification_settings (user_id, email, timezone, email_enabled, push_enabled, reminder_minutes)
        VALUES (${user.id}, ${user.email}, ${body.timezone || 'UTC'}, ${body.emailEnabled ?? true}, ${body.pushEnabled ?? false}, 10)
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, timezone = EXCLUDED.timezone,
          email_enabled = EXCLUDED.email_enabled, push_enabled = EXCLUDED.push_enabled, updated_at = NOW()
        RETURNING email, timezone, email_enabled, push_enabled, reminder_minutes
      `
      return json({ settings })
    }
    return new Response('Method not allowed', { status: 405 })
  } catch (error) { return errorResponse(error) }
}

export const config: Config = { path: '/api/settings', method: ['GET', 'PUT'] }
