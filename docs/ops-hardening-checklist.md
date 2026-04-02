# Ops Hardening Checklist (Hosted)

Use this before expanding beyond pilot users.

## Monitoring and alerting

- Track service uptime/restarts from hosting platform.
- Alert on high error rate (5xx from API and Slack action failures).
- Alert on repeated outbox failures (stuck `integration_outbox` pending events).
- Alert on circuit-open errors from integration reliability layer.

## Token and secret ownership

- Assign a single team owner for Slack app token rotation.
- Store all secrets in deployment platform secret manager (not in repo files).
- Rotate:
  - `SLACK_BOT_TOKEN`
  - `SLACK_APP_TOKEN`
  - `SLACK_SIGNING_SECRET`
  - `API_SERVER_AUTH_TOKEN`
- Keep an access log for secret changes and deployment events.

## On-call response

- Create runbook links for:
  - integration fallback (`INTEGRATION_PROVIDER=stub`)
  - `PILOT_MODE=shadow` rollback
  - Slack app reinstallation/token refresh
- Define escalation owner and backup owner for business hours + after hours.

## Reliability checks

- Confirm `INTEGRATION_MAX_RETRIES` and circuit settings are non-zero.
- Verify idempotency behavior for booking/change endpoints with repeated requests.
- Verify duplicate Slack message protection is active in hosted env.

## Compliance-adjacent controls

- Keep `REDACT_LOGS=1`.
- Confirm audit logs are retained per internal policy.
- Document that this is not a HIPAA attestation unless formal review is completed.
