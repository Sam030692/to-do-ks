import type { Config } from '@netlify/functions'
import { getDatabase } from '@netlify/database'
import webpush from 'web-push'
import { requireUser, json, errorResponse } from './_shared/auth'
import { getOrCreateVapidConfig } from './_shared/vapid'

export default async (req: Request) => {
  try {
    const user = await requireUser()
    const db = getDatabase()

    if (req.method === 'GET') {
      const vapid = await getOrCreateVapidConfig()
      return json({ publicKey: vapid.publicKey })
    }

    const body = await req.json() as { subscription?: PushSubscriptionJSON; endpoint?: string }

    if (req.method === 'POST') {
      if (!body.subscription?.endpoint) return json({ error: 'Invalid subscription' }, 400)

      await db.sql`
        INSERT INTO push_subscriptions (user_id, endpoint, subscription)
        VALUES (${user.id}, ${body.subscription.endpoint}, ${JSON.stringify(body.subscription)}::jsonb)
        ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription, updated_at = NOW()
      `

      const vapid = await getOrCreateVapidConfig()
      webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)

      try {
        await webpush.sendNotification(
          body.subscription as webpush.PushSubscription,
          JSON.stringify({
            title: 'To-do Today notifications are on',
            body: 'You’ll get a reminder 10 minutes before timed tasks.',
            url: '/',
            tag: 'todo-push-test',
          }),
        )
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await db.sql`DELETE FROM push_subscriptions WHERE endpoint = ${body.subscription.endpoint} AND user_id = ${user.id}`
        }
        console.error('Web Push test failed', error)
        return json({ error: `Push subscription saved, but the test notification failed${error?.statusCode ? ` (${error.statusCode})` : ''}.` }, 502)
      }

      return json({ ok: true, testSent: true })
    }

    if (req.method === 'DELETE') {
      if (body.endpoint) {
        await db.sql`DELETE FROM push_subscriptions WHERE endpoint = ${body.endpoint} AND user_id = ${user.id}`
      }
      return json({ ok: true })
    }

    return new Response('Method not allowed', { status: 405 })
  } catch (error) {
    return errorResponse(error)
  }
}

export const config: Config = {
  path: '/api/push',
  method: ['GET', 'POST', 'DELETE'],
}
