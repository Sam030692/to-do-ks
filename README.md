# To-do Today

A focused daily to-do PWA for Netlify.

## Included

- Google sign-in via Netlify Identity
- Today's tasks: name, details, optional time, priority
- Complete, restore, edit and delete tasks
- 10-minute-before reminders for timed tasks
- Web Push notifications through the browser Push API
- Email reminders through Gmail SMTP
- Event-driven reminder delivery through Upstash QStash
- Netlify Database/Postgres persistence
- Responsive installable PWA

## Architecture

React + Vite -> Netlify

Netlify Identity -> Google authentication

Netlify Database -> tasks, settings, push subscriptions

Timed task create/edit -> one delayed QStash message

QStash at reminder time -> `/api/reminder` -> Gmail email + Web Push

There is **no recurring Netlify reminder poll**. This allows Netlify Database to sleep between actual app activity and reminder deliveries instead of being kept awake every minute.

## Google login

1. Netlify -> Project configuration -> Identity.
2. Enable Identity.
3. Under External providers, enable Google.

The app uses `@netlify/identity` and is Google-login only.

## Gmail email reminders

Use a Gmail account dedicated to reminder delivery when possible.

1. Enable 2-Step Verification on the Gmail account.
2. Create a Google App Password named `To-do Today`.
3. Add these Netlify environment variables:

```text
GMAIL_USER=your-reminder-account@gmail.com
GMAIL_APP_PASSWORD=your-16-character-app-password
```

`GMAIL_APP_PASSWORD` must be stored as a secret and never committed to GitHub.

## QStash reminder scheduling

Create a QStash account and add one additional Netlify secret:

```text
QSTASH_TOKEN=...
```

The reminder webhook authentication token is derived server-side from the existing Gmail app password; the Gmail password itself is never sent to QStash.

When a timed task is created, QStash holds one delayed message until 10 minutes before the task. Editing, completing, or deleting the task cancels the old pending message; editing or restoring schedules a new one when appropriate.

QStash Free supports delayed messages up to 7 days, which is sufficient for this app because it is intentionally Today-only.

## Web Push

The app creates and stores its VAPID keypair privately in the Netlify Database on first use. No VAPID environment variables are required.

Users enable Push from Settings. On supported iOS/iPadOS versions, install the PWA to the Home Screen before enabling notifications.

## Reminder behavior

- Timed tasks get a reminder 10 minutes before the due time.
- Tasks without a time do not get reminders.
- Completed/deleted tasks cancel their pending delayed reminder.
- Edited tasks cancel the stale reminder and schedule a replacement.
- The reminder webhook validates an app-only bearer token before accessing task data.
- Email and Web Push have separate sent markers so retries do not intentionally duplicate a channel that already succeeded.
- Netlify is not polled in the background.

## Environment variables

```text
GMAIL_USER
GMAIL_APP_PASSWORD
QSTASH_TOKEN
```

After adding or changing environment variables, trigger one production deploy.

## Database

The initial migration is at `netlify/database/migrations/001_initial/migration.sql`.

Tables include:

- `tasks`
- `notification_settings`
- `push_subscriptions`
- private app configuration for Web Push

All normal task queries are scoped to the authenticated Netlify Identity user ID.

## Local development

```bash
npm install
npm run dev
```

## Production checklist

- [x] Google provider enabled in Netlify Identity
- [x] Gmail username configured
- [x] Gmail app password configured
- [ ] QStash token configured
- [ ] One production deploy after the event-driven reminder changes
- [ ] Enable Web Push
- [ ] Create a task about 12 minutes ahead and verify email + push delivery

## Notes

This first version is intentionally "Today" only. It does not include projects, subtasks, recurring tasks, future-day planning, collaboration, or Google Calendar sync.
