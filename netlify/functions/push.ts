import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import { requireUser, json, errorResponse } from './_shared/auth'

export default async (req: Request) => {
  try {
    const user = await requireUser()
    const db = getDatabase()
    if (req.method === 'GET') {
      return json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' })
    }
    const body = await req.json() as { subscription?: PushSubscriptionJSON; endpoint?: string }
    if (req.method === 'POST') {
      if (!body.subscription?.endpoint) return json({ error: 'Invalid subscription' }, 400)
      await db.sql`
        INSERT INTO push_subscriptions (user_id, endpoint, subscription)
        VALUES (${user.id}, ${body.subscription.endpoint}, ${JSON.stringify(body.subscription)}::jsonb)
        ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription, updated_at = NOW()
      `
      return json({ ok: true })
    }
    if (req.method === 'DELETE') {
      if (body.endpoint) await db.sql`DELETE FROM push_subscriptions WHERE endpoint = ${body.endpoint} AND user_id = ${user.id}`
      return json({ ok: true })
    }
    return new Response('Method not allowed', { status: 405 })
  } catch (error) { return errorResponse(error) }
}

export const config: Config = { path: '/api/push', method: ['GET', 'POST', 'DELETE'] }
