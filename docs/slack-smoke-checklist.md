# Slack Smoke Checklist (Hosted)

Use this after deploying to Render (or any hosted platform).

## Prerequisites

- Service is healthy (`/healthz`, `/readyz`).
- Slack app is installed in workspace.
- Bot invited to test channel.

## Scope check

Confirm bot scopes include at minimum:

- `chat:write`
- `channels:history` (plus relevant groups/im/mpim history scopes)
- `app_mentions:read`
- `users:read`
- `files:read` (if using voice clips)

## Thread tests (manual)

In a channel with the bot:

1. Availability: ask for open slots.
2. Booking: ask to book one concrete slot.
3. Reminder: ask for reminder in 2 minutes.
4. Appointment change: cancel or reschedule with a reference.
5. Policy handoff: use a known red-line phrase in a controlled test channel only.

Expected:

- Bot replies in thread.
- Booking/change actions produce one result only.
- Handoff posts contextual package when triggered.

## API smoke (optional but recommended)

Run:

```bash
API_BASE_URL=https://your-service.onrender.com \
API_SERVER_AUTH_TOKEN=... \
npm run smoke:hosted
```

## Sign-off criteria

- All tests pass in one run.
- No duplicate booking messages.
- Logs show expected `receptionist_metric` and `receptionist_audit` events.
