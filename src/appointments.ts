import { randomBytes } from "node:crypto";
import { getDb } from "./db.js";

export const APPT_STATUS_SCHEDULED = "scheduled";
export const APPT_STATUS_CANCELLED = "cancelled";

export function normalizeSlotLabel(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function newAppointmentId(): string {
  return `GH-APT-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export type AppointmentRow = {
  id: string;
  slot_label: string;
  patient_ref: string | null;
  visit_type: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  session_key: string | null;
  user_id: string | null;
};

function ensureAppointmentsTable(): void {
  getDb().exec(`
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
}

/** Active bookings only — normalized keys for slot matching. */
export function listActiveBookedSlotKeys(): Set<string> {
  ensureAppointmentsTable();
  const rows = getDb()
    .prepare(`SELECT slot_label FROM appointments WHERE status = ?`)
    .all(APPT_STATUS_SCHEDULED) as { slot_label: string }[];
  return new Set(rows.map((r) => normalizeSlotLabel(r.slot_label)));
}

/** True if another active appointment already holds this slot. */
export function isSlotTakenByOther(slotLabel: string, excludeAppointmentId?: string): boolean {
  ensureAppointmentsTable();
  const key = normalizeSlotLabel(slotLabel);
  const all = getDb()
    .prepare(`SELECT id, slot_label FROM appointments WHERE status = ?`)
    .all(APPT_STATUS_SCHEDULED) as { id: string; slot_label: string }[];
  return all.some(
    (a) =>
      normalizeSlotLabel(a.slot_label) === key &&
      (!excludeAppointmentId || a.id !== excludeAppointmentId),
  );
}

export type BookInput = {
  slotLabel: string;
  patientRef?: string | null;
  visitType?: string | null;
  sessionKey?: string | null;
  userId?: string | null;
};

export type BookResult =
  | { ok: true; id: string; slot_label: string }
  | { ok: false; reason: string };

export function bookAppointment(input: BookInput): BookResult {
  ensureAppointmentsTable();
  const slot = input.slotLabel.trim();
  if (!slot) return { ok: false, reason: "empty_slot" };
  if (isSlotTakenByOther(slot)) return { ok: false, reason: "slot_taken" };

  const id = newAppointmentId();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO appointments(id, slot_label, patient_ref, visit_type, status, created_at, updated_at, session_key, user_id)
       VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      slot,
      input.patientRef?.trim() || null,
      input.visitType?.trim() || null,
      APPT_STATUS_SCHEDULED,
      now,
      now,
      input.sessionKey ?? null,
      input.userId ?? null,
    );

  console.log(
    JSON.stringify({
      type: "appointment_booked",
      id,
      slot_label: slot,
      patient_ref: input.patientRef ?? null,
      visit_type: input.visitType ?? null,
      at: now,
    }),
  );

  return { ok: true, id, slot_label: slot };
}

function getScheduledById(id: string): AppointmentRow | undefined {
  ensureAppointmentsTable();
  const uid = id.trim().toUpperCase();
  return getDb()
    .prepare(`SELECT * FROM appointments WHERE upper(id) = ? AND status = ?`)
    .get(uid, APPT_STATUS_SCHEDULED) as AppointmentRow | undefined;
}

function getLatestScheduledByPatientRef(ref: string): AppointmentRow | undefined {
  ensureAppointmentsTable();
  const r = ref.trim().toUpperCase();
  return getDb()
    .prepare(
      `SELECT * FROM appointments WHERE upper(trim(patient_ref)) = ? AND status = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(r, APPT_STATUS_SCHEDULED) as AppointmentRow | undefined;
}

/** Resolve GH-APT-… id or patient ref like GH-xxxx. */
export function resolveActiveAppointment(publicRef: string): AppointmentRow | undefined {
  const t = publicRef.trim().toUpperCase();
  if (/^GH-APT-[A-F0-9]+$/i.test(t)) return getScheduledById(t);
  return getLatestScheduledByPatientRef(t);
}

export type CancelResult =
  | { ok: true; id: string; slot_label: string }
  | { ok: false; reason: "not_found" | "invalid_ref" };

export function cancelAppointmentByRef(publicRef: string): CancelResult {
  const row = resolveActiveAppointment(publicRef);
  if (!row) return { ok: false, reason: "not_found" };

  const now = new Date().toISOString();
  getDb()
    .prepare(`UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?`)
    .run(APPT_STATUS_CANCELLED, now, row.id);

  console.log(
    JSON.stringify({
      type: "appointment_cancelled",
      id: row.id,
      slot_label: row.slot_label,
      at: now,
    }),
  );

  return { ok: true, id: row.id, slot_label: row.slot_label };
}

export type RescheduleResult =
  | { ok: true; id: string; old_slot: string; new_slot: string; change_id: string }
  | { ok: false; reason: "not_found" | "slot_taken" | "invalid_slot" };

export function rescheduleAppointmentByRef(publicRef: string, newSlotRaw: string): RescheduleResult {
  const row = resolveActiveAppointment(publicRef);
  if (!row) return { ok: false, reason: "not_found" };

  const newSlot = newSlotRaw.trim();
  if (!newSlot) return { ok: false, reason: "invalid_slot" };

  if (isSlotTakenByOther(newSlot, row.id)) return { ok: false, reason: "slot_taken" };

  const changeId = `GH-RS-${randomBytes(3).toString("hex").toUpperCase()}`;
  const now = new Date().toISOString();
  const oldSlot = row.slot_label;

  getDb()
    .prepare(`UPDATE appointments SET slot_label = ?, updated_at = ? WHERE id = ?`)
    .run(newSlot, now, row.id);

  console.log(
    JSON.stringify({
      type: "appointment_rescheduled",
      id: row.id,
      change_id: changeId,
      old_slot: oldSlot,
      new_slot: newSlot,
      at: now,
    }),
  );

  return { ok: true, id: row.id, old_slot: oldSlot, new_slot: newSlot, change_id: changeId };
}
