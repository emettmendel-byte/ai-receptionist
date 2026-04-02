import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";

export type OutboxEvent = {
  id: string;
  topic: string;
  payload_json: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export function enqueueIntegrationEvent(topic: string, payload: unknown): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO integration_outbox(id, topic, payload_json, status, attempts, last_error, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(id, topic, JSON.stringify(payload), "pending", 0, null, now, now);
  return id;
}

export function listPendingOutbox(limit = 50): OutboxEvent[] {
  return getDb()
    .prepare(
      `SELECT * FROM integration_outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as OutboxEvent[];
}

export function markOutboxDispatched(id: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE integration_outbox SET status = 'dispatched', updated_at = ? WHERE id = ?`)
    .run(now, id);
}

export function markOutboxError(id: string, err: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE integration_outbox
       SET status = 'pending', attempts = attempts + 1, last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(err.slice(0, 400), now, id);
}
