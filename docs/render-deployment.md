# Render Deployment (Socket Mode)

This guide deploys the bot as an always-on service so Slack users can interact without a local machine.

## 1) Create service

1. Push this repo to GitHub.
2. In Render, create a new **Web Service** from the repo.
3. Use the blueprint file: `render.yaml` (recommended), or copy settings manually:
   - Build: `npm install && npm run build`
   - Start: `npm start`
   - Health check path: `/healthz`

## 2) Required secrets

Set these in Render dashboard (or via Blueprint secret sync):

- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_WORKSPACE_DOMAIN`
- `API_SERVER_AUTH_TOKEN`
- `OLLAMA_HOST` (if using external LLM endpoint)

Use [`.env.production.example`](../.env.production.example) as baseline for values and defaults.

## 3) Storage

For pilot mode with SQLite:

- Attach persistent disk (already modeled in `render.yaml`)
- Keep `DATA_DIR=/var/data`

For multi-instance production:

- Replace SQLite with managed DB strategy before horizontal scaling.

## 4) Verify deployment

- `GET /healthz` -> `{"ok":true,...}`
- `GET /readyz` -> provider/capabilities response
- Send a Slack message in an invited channel and confirm bot response.

## 5) Rollout mode

Start with:

- `PILOT_MODE=shadow`
- `INTEGRATION_PROVIDER=stub`

Then switch to real adapters and live mode after validation.
