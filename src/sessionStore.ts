import { getDb } from "./db.js";
import type { SessionState } from "./types.js";

const emptyState = (): SessionState => ({
  turns: [],
  clarify_count: 0,
});

export function sessionKey(userId: string, threadTs: string): string {
  return `${userId}:${threadTs}`;
}

export function loadSession(key: string): SessionState {
  const row = getDb()
    .prepare(`SELECT json FROM sessions WHERE session_key = ?`)
    .get(key) as { json: string } | undefined;
  if (!row) return emptyState();
  try {
    return JSON.parse(row.json) as SessionState;
  } catch {
    return emptyState();
  }
}

export function saveSession(key: string, state: SessionState): void {
  const json = JSON.stringify(state);
  const updated = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO sessions(session_key, json, updated_at) VALUES(?,?,?)
       ON CONFLICT(session_key) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`,
    )
    .run(key, json, updated);
}

export function appendTurn(
  key: string,
  role: "user" | "assistant",
  text: string,
): SessionState {
  const s = loadSession(key);
  if (s.turns.length >= 50) s.turns = s.turns.slice(-40);
  s.turns.push({ role, text, at: new Date().toISOString() });
  saveSession(key, s);
  return s;
}
