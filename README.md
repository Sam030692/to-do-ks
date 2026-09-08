# To-do Today

A focused daily to-do PWA for Netlify.

## Included

- Google sign-in via Netlify Identity
- Today's tasks: name, details, optional time, priority
- Complete, restore, edit and delete tasks
- 10-minute-before reminders for timed tasks
- Web Push notifications through the browser Push API
- Email reminders through Gmail SMTP
- Netlify scheduled reminder sweep every minute
- Netlify Database/Postgres persistence
- Responsive installable PWA

## Architecture

React + Vite -> Netlify

Netlify Identity -> Google authentication

Netlify Database -> tasks, settings, push subscriptions

Netlify Scheduled Function -> checks once per minute for due reminders

Reminder sweep -> Gmail email + Web Push

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

The reminder email is sent to the email address associated with the signed-in app user.

## Web Push

Add these server-side Netlify environment variables:

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:your-email@example.com
```

Users enable Push from Settings. On supported iOS/iPadOS versions, install the PWA to the Home Screen before enabling notifications.

## Reminder behavior

- Timed tasks get a reminder 10 minutes before the due time.
- The Netlify scheduled function runs every minute in UTC and selects reminders due for delivery.
- Completed or deleted tasks are skipped.
- Email and Web Push have separate sent markers to prevent intentional duplicates.
- Tasks without a time do not get reminders.

## Environment variables

```text
GMAIL_USER
GMAIL_APP_PASSWORD
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

After adding or changing environment variables, trigger a fresh production deploy.

## Database

The migration is at `netlify/database/migrations/001_initial/migration.sql`.

Tables:

- `tasks`
- `notification_settings`
- `push_subscriptions`

All task queries are scoped to the authenticated Netlify Identity user ID.

## Local development

```bash
npm install
npm run dev
```

## Production checklist

- [x] Google provider enabled in Netlify Identity
- [x] VAPID keys configured
- [x] Netlify scheduled reminder function deployed
- [x] Gmail username configured
- [x] Gmail app password configured
- [ ] Fresh production deploy completed after Gmail credentials
- [ ] Sign in with Google
- [ ] Enable Web Push in Settings
- [ ] Create a task about 12 minutes ahead and verify email + push delivery

## Notes

This first version is intentionally "Today" only. It does not include projects, subtasks, recurring tasks, future-day planning, collaboration, or Google Calendar sync.
