# Greens Receptionist Integration Runbook

This runbook describes how to onboard Greens systems and run a safe pilot rollout.

## 1) Secrets and security baseline

- Do not store production credentials in `.env` on shared machines.
- Provide runtime secrets via your deployment platform secret manager.
- Set `API_SERVER_AUTH_TOKEN` when `API_SERVER_ENABLED=1`.
- Use `x-scopes` and `x-actor-id` headers for API calls to enforce action-level authorization in core actions.
- Keep `REDACT_LOGS=1` so audit and metric logs mask sensitive patterns.

## 2) Provider onboarding checklist

1. Implement provider interfaces in `src/integrations/types.ts`.
2. Add adapter implementation under `src/integrations/`.
3. Register provider in `src/integrations/registry.ts`.
4. Set `INTEGRATION_PROVIDER=<new-provider>`.
5. Run test suites:
   - `npm test`
   - `npm run test:llm` (optional behavior quality pass)
6. Verify health:
   - `GET /healthz`
   - `GET /readyz`

## 3) Pilot rollout (shadow to progressive activation)

### Stage A: Shadow mode

- Set `PILOT_MODE=shadow`.
- Keep all `FEATURE_*` enabled, but have staff verify each suggested action manually.
- Track mismatch reasons in escalation channel.

### Stage B: Controlled activation

- Enable in this order:
  1. `FEATURE_AVAILABILITY=1`
  2. `FEATURE_BOOKING=1`
  3. `FEATURE_APPOINTMENT_CHANGE=1`
  4. `FEATURE_ELIGIBILITY=1`
- Keep patient drafting and intake enabled only after staff sign-off.

### Stage C: Expanded pilot

- Move to a second clinic or team after 1-2 weeks of stable metrics.
- Keep policy red-line escalation and human handoff active for all sites.

## 4) Incident fallback

- If an integration provider is unstable, switch to `INTEGRATION_PROVIDER=stub`.
- Keep Slack operational while external systems recover.
- Review `integration_outbox` and replay pending events after incident.
