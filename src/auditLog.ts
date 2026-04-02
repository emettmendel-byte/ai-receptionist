import { getDb } from "./db.js";

export type AuditEntry = {
  session_key: string;
  user_id: string;
  intent: string;
  confidence: number;
  path: string;
  phi_flag: boolean;
  action_summary: string;
  text_preview: string;
};

export function ensureAuditTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      session_key TEXT NOT NULL,
      user_id TEXT NOT NULL,
      intent TEXT NOT NULL,
      confidence REAL NOT NULL,
      path TEXT NOT NULL,
      phi_flag INTEGER NOT NULL,
      action_summary TEXT NOT NULL,
      text_preview TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  `);
}

/** Structured demo audit (Sully-style logging story; not HIPAA attestation). */
export function appendAudit(entry: AuditEntry): void {
  ensureAuditTable();
  const preview = entry.text_preview.slice(0, 200).replace(/\n/g, " ");
  getDb()
    .prepare(
      `INSERT INTO audit_log(created_at, session_key, user_id, intent, confidence, path, phi_flag, action_summary, text_preview)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      new Date().toISOString(),
      entry.session_key,
      entry.user_id,
      entry.intent,
      entry.confidence,
      entry.path,
      entry.phi_flag ? 1 : 0,
      entry.action_summary,
      preview,
    );

  console.log(
    JSON.stringify({
      type: "receptionist_audit",
      ...entry,
      text_preview: preview,
    }),
  );
}
