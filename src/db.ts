import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

let _db: Database.Database | null = null;

/** Close the DB handle (e.g. between tests). Next getDb() opens a new file. */
export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* ignore */
    }
    _db = null;
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const fp = path.join(config.dataDir, "receptionist.db");
  const db = new Database(fp);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminder_jobs (
      id TEXT PRIMARY KEY,
      fire_at INTEGER NOT NULL,
      channel_id TEXT NOT NULL,
      thread_ts TEXT,
      text TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      slack_scheduled_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminder_fire ON reminder_jobs(fire_at, status);
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
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      slot_label TEXT NOT NULL,
      patient_ref TEXT,
      visit_type TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      session_key TEXT,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);
    CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_ref, status);
  `);
  _db = db;
  return db;
}
