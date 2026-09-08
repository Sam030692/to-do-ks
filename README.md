# To-do Today

A focused daily to-do PWA for Netlify.

## Included

- Google sign-in via Netlify Identity
- Today's tasks: name, details, optional time, priority
- Complete, restore, edit and delete tasks
- 10-minute-before reminders for timed tasks
- Web Push notifications through the browser Push API
- Email reminders through Resend
- Precise delayed delivery through Upstash QStash (no every-minute database polling)
- Netlify Database/Postgres persistence
- Responsive installable PWA

## Architecture

React + Vite -> Netlify

Netlify Identity -> Google authentication

Netlify Database -> tasks, settings, push subscriptions

QStash -> calls `/api/reminder` 10 minutes before a timed task

`/api/reminder` -> Resend email + Web Push

## Deploy

This ZIP contains **source code**, because Netlify needs to run the build, database migration, and Functions packaging. Do not use Netlify Drop as a static-only upload.

### Option A — Git (recommended)

1. Unzip this project.
2. Push the folder to a GitHub repository.
3. In Netlify choose **Add new project > Import an existing project**.
4. Select the repository. Netlify will read `netlify.toml` automatically.
5. Deploy once. Netlify Database is provisioned automatically and the SQL migration runs during deploy.

### Option B — Netlify CLI

Requires Node 18.14+.

```bash
npm install
npm install -g netlify-cli
netlify login
netlify init --manual
netlify deploy --build --prod
```

## 1. Enable Google login

After the first deploy:

1. Netlify -> Project configuration -> Identity.
2. Enable Identity if it is not already enabled.
3. Under External providers, enable **Google**.
4. Keep the app Google-only; no email/password UI is included.

The app uses the current `@netlify/identity` package, not the deprecated Identity widget.

> Netlify Identity OAuth should be tested on a deployed preview/production URL rather than relying on local `netlify dev`.

## 2. Create free QStash credentials

Create a QStash account/project at Upstash and copy:

- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

Add them in Netlify -> Project configuration -> Environment variables.

QStash is used only when a timed task is created/edited. It delays one callback until the reminder time. Since To-do Today only schedules today's tasks, QStash Free's delayed-message window is suitable.

## 3. Configure email reminders (Resend)

1. Create a Resend account/API key.
2. For production, verify a sending domain in Resend.
3. Add:

```text
RESEND_API_KEY=re_...
RESEND_FROM=To-do Today <reminders@your-domain.com>
```

For initial testing you can use a sender allowed by your Resend account.

The reminder email goes to the same email address supplied by Google sign-in.

## 4. Configure Web Push

After `npm install`, generate VAPID keys:

```bash
npm run vapid
```

Add the output to Netlify environment variables:

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your-email@example.com
```

Only the public VAPID key is exposed to the browser. The private key remains server-side.

Users enable Push from **Settings -> Web Push**. Browser notification permission is requested at that point.

### iPhone/iPad

For web push on supported iOS/iPadOS versions, install the site to the Home Screen first and then enable notifications from the installed web app.

## 5. Environment variables checklist

Copy `.env.example` as a reference. In Netlify, set these as server-side environment variables:

```text
QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
RESEND_API_KEY
RESEND_FROM
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

Do **not** add `VITE_` to these secret names.

After adding/changing environment variables, redeploy the site.

## Database

The migration is at:

`netlify/database/migrations/001_initial/migration.sql`

Tables:

- `tasks`
- `notification_settings`
- `push_subscriptions`

All task queries are scoped to the authenticated Netlify Identity user ID.

## Reminder safety

- A completed or deleted task has its pending QStash message cancelled.
- Editing the time cancels the old reminder and schedules a new one.
- Each QStash callback carries the expected reminder timestamp, so a stale callback is ignored even if cancellation races with delivery.
- Email and push each have their own `sent_at` marker, so QStash retries do not intentionally duplicate a channel that already succeeded.
- The reminder endpoint verifies the QStash signature before processing.

## Local development

```bash
npm install
npm run dev
```

For full Netlify platform behavior use Netlify tooling. Google Identity OAuth itself is best tested on a Netlify deploy.

## Production checklist

- [ ] Google provider enabled in Netlify Identity
- [ ] QStash variables added
- [ ] Resend sending domain verified + variables added
- [ ] VAPID keys generated + variables added
- [ ] Production redeploy completed
- [ ] Sign in with Google
- [ ] Enable Web Push in Settings
- [ ] Create a task 12+ minutes ahead and verify email + push delivery

## Notes

This first version is intentionally "Today" only. It does not include projects, subtasks, recurring tasks, future-day planning, collaboration, or Google Calendar sync.
