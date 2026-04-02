import type { IntentId } from "./intents.js";

export type MessageRole = "user" | "assistant";

export type ChatTurn = {
  role: MessageRole;
  text: string;
  at: string; // ISO
};

export type EntityMap = {
  who?: string;
  what?: string;
  when?: string;
  /** When present (e.g. reminders), ISO-8601 in America/New_York for demo. */
  when_iso?: string;
  patient_id?: string;
  program?: string;
  raw_notes?: string;
  payer?: string;
  member_id?: string;
  /** BCP-47 or ISO-ish code when user asks for another language (demo). */
  language?: string;
};

export type Classification = {
  intent: IntentId | "unknown";
  confidence: number;
  entities: EntityMap;
  needs_clarification: boolean;
  clarification_question?: string;
  rationale?: string;
};

export type AppointmentFlowState = {
  action?: "reschedule" | "cancel" | "waitlist";
  appointment_id?: string;
  when_hint?: string;
};

/** Pre-visit intake checklist (multi-turn). `next_field` is what the user’s reply will fill. */
export type IntakeFlowState = {
  next_field: "meds" | "allergies" | "pharmacy";
  meds?: string;
  allergies?: string;
};

export type SessionState = {
  turns: ChatTurn[];
  clarify_count: number;
  last_intent?: IntentId | "unknown";
  /** Last `GH-APT-…` booked in this thread (for “reschedule this” without id). */
  last_booked_appointment_id?: string | null;
  /** Active multi-turn appointment change; set `null` to clear when saving. */
  appointment_flow?: AppointmentFlowState | null;
  /** Active pre-visit intake; set `null` to clear when saving. */
  intake_flow?: IntakeFlowState | null;
};

export type MetricsEntry = {
  session_key: string;
  intent: string;
  confidence: number;
  started_at: string;
  replied_at: string;
  latency_ms: number;
  path: "automated" | "escalation" | "clarify" | "policy_escalation";
};
