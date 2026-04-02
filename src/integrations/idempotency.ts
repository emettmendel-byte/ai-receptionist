import { getDb } from "../db.js";

export type IdempotencyClaim =
  | { status: "new" }
  | { status: "duplicate_in_progress" }
  | { status: "replay"; response: unknown };

export function claimIdempotency(scope: string, key: string): IdempotencyClaim {
  const now = new Date().toISOString();
  const existing = getDb()
    .prepare(`SELECT status, response_json FROM idempotency_keys WHERE key = ? AND scope = ?`)
    .get(key, scope) as { status: string; response_json: string | null } | undefined;
  if (!existing) {
    getDb()
      .prepare(
        `INSERT INTO idempotency_keys(key, scope, response_json, status, created_at, updated_at)
         VALUES(?,?,?,?,?,?)`,
      )
      .run(key, scope, null, "in_progress", now, now);
    return { status: "new" };
  }
  if (existing.status === "completed" && existing.response_json) {
    try {
      return { status: "replay", response: JSON.parse(existing.response_json) };
    } catch {
      return { status: "replay", response: existing.response_json };
    }
  }
  return { status: "duplicate_in_progress" };
}

export function completeIdempotency(scope: string, key: string, response: unknown): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE idempotency_keys SET status = 'completed', response_json = ?, updated_at = ? WHERE key = ? AND scope = ?`,
    )
    .run(JSON.stringify(response), now, key, scope);
}
