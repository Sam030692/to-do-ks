import { getDatabase } from '@netlify/database'
import webpush from 'web-push'

type VapidConfig = {
  publicKey: string
  privateKey: string
  subject: string
}

export async function getOrCreateVapidConfig(): Promise<VapidConfig> {
  const db = getDatabase()

  await db.sql`
    CREATE TABLE IF NOT EXISTS app_config (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      vapid_public_key TEXT NOT NULL,
      vapid_private_key TEXT NOT NULL,
      vapid_subject TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `

  const [existing] = await db.sql`
    SELECT vapid_public_key, vapid_private_key, vapid_subject
    FROM app_config
    WHERE id = 1
  `

  if (existing) {
    return {
      publicKey: String(existing.vapid_public_key),
      privateKey: String(existing.vapid_private_key),
      subject: String(existing.vapid_subject),
    }
  }

  const keys = webpush.generateVAPIDKeys()
  const gmailUser = Netlify.env.get('GMAIL_USER') || 'todotoday.reminders@gmail.com'
  const subject = `mailto:${gmailUser}`

  await db.sql`
    INSERT INTO app_config (id, vapid_public_key, vapid_private_key, vapid_subject)
    VALUES (1, ${keys.publicKey}, ${keys.privateKey}, ${subject})
    ON CONFLICT (id) DO NOTHING
  `

  const [created] = await db.sql`
    SELECT vapid_public_key, vapid_private_key, vapid_subject
    FROM app_config
    WHERE id = 1
  `

  if (!created) throw new Error('Could not initialize Web Push configuration')

  return {
    publicKey: String(created.vapid_public_key),
    privateKey: String(created.vapid_private_key),
    subject: String(created.vapid_subject),
  }
}
