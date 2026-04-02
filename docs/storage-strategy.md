# Storage Strategy (Hosted)

This project currently uses SQLite for sessions, appointments, reminders, outbox, and idempotency records.

## Option A: Persistent disk + SQLite (pilot)

Recommended for fast pilot / single instance.

- Configure:
  - `DATA_DIR=/var/data` (or platform persistent mount)
  - one service instance only
- Pros:
  - fastest setup
  - no schema migration complexity
- Risks:
  - not suitable for multi-replica horizontal scaling
  - lower operational durability than managed DB

## Option B: Managed DB (production scale)

Recommended before multi-instance rollout.

- Replace SQLite access layer in `src/db.ts` with managed DB client.
- Preserve table semantics for:
  - `sessions`
  - `appointments`
  - `reminder_jobs`
  - `audit_log`
  - `integration_outbox`
  - `idempotency_keys`
- Add migration workflow and backups.

## Decision guidance

- Choose **Option A** when:
  - one clinic pilot
  - one instance
  - fast validation is priority
- Choose **Option B** when:
  - more than one instance or region
  - strict RPO/RTO requirements
  - broader organizational rollout

## Immediate default for this repo

- Pilot: persistent disk + SQLite (`DATA_DIR=/var/data`).
- Planned next step: managed DB migration before scale-out.
