/**
 * Hosted API smoke checks (no Slack token required).
 *
 * Usage:
 *   API_BASE_URL=https://your-service.onrender.com \
 *   API_SERVER_AUTH_TOKEN=... \
 *   npm run smoke:hosted
 */

const base = process.env.API_BASE_URL?.replace(/\/$/, "");
const token = process.env.API_SERVER_AUTH_TOKEN ?? "";

if (!base) {
  console.error("Missing API_BASE_URL.");
  process.exit(1);
}

const headers: Record<string, string> = {
  "content-type": "application/json",
  "x-actor-id": "smoke-checker",
  "x-scopes": "admin",
};
if (token) headers.authorization = `Bearer ${token}`;

async function check(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} failed HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  console.log(`OK ${path} -> ${text.slice(0, 180)}`);
}

async function main(): Promise<void> {
  await check("/healthz");
  await check("/readyz");
  await check("/availability");
  await check("/eligibility/check", {
    method: "POST",
    body: JSON.stringify({ patientId: "GH-SMOKE-1", payer: "DemoPayer", memberId: "M-SMOKE-1" }),
  });
  await check("/drafts/patient-message", {
    method: "POST",
    body: JSON.stringify({ channel: "sms", purpose: "Smoke test message" }),
  });
  console.log("Hosted smoke checks completed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
