import { randomBytes } from "node:crypto";

export type ScheduleHoldResult = {
  hold_id: string;
  suggested_window: string;
  ehr_stub: string;
};

/** Stub: would call scheduling/EHR adapter in production. */
export function stubCreateScheduleHold(input: {
  who?: string;
  when?: string;
  what?: string;
}): ScheduleHoldResult {
  const id = `GH-HOLD-${randomBytes(3).toString("hex").toUpperCase()}`;
  const window =
    input.when?.trim() ||
    "Next available CCM telehealth window (stub): Thu 10:30am or Fri 2:00pm";
  return {
    hold_id: id,
    suggested_window: window,
    ehr_stub: "Athena/Epic bridge not connected — hold stored in prototype ledger only.",
  };
}

export type EligibilityStubResult = {
  eligibility_id: string;
  status: string;
  payer: string;
  detail: string;
};

/** Stub payer eligibility (no real API). */
export function stubCheckInsuranceEligibility(input: {
  patient_id?: string;
  payer?: string;
  member_id?: string;
}): EligibilityStubResult {
  const id = `GH-ELIG-${randomBytes(3).toString("hex").toUpperCase()}`;
  const payer = input.payer?.trim() || "UNKNOWN_PAYER_STUB";
  return {
    eligibility_id: id,
    status: "ACTIVE_DEMO",
    payer,
    detail: `Mock response for patient ${input.patient_id ?? "unspecified"} / member ${input.member_id ?? "n/a"} — _not a real eligibility check._`,
  };
}

export type AppointmentChangeResult = {
  change_id: string;
  ehr_stub: string;
};

export function stubAppointmentChange(input: {
  action: "reschedule" | "cancel";
  appointment_id: string;
  when_hint: string;
  raw_notes?: string;
}): AppointmentChangeResult {
  const id = `GH-APPT-${randomBytes(3).toString("hex").toUpperCase()}`;
  return {
    change_id: id,
    ehr_stub: `Would ${input.action} ${input.appointment_id} in live EHR; prototype logged only. Notes: ${(input.raw_notes ?? "").slice(0, 80)}`,
  };
}

export type WaitlistResult = {
  request_id: string;
  note: string;
};

export function stubWaitlistRequest(input: {
  appointment_id: string;
  when_hint: string;
  raw_notes?: string;
}): WaitlistResult {
  return {
    request_id: `GH-WL-${randomBytes(3).toString("hex").toUpperCase()}`,
    note: `Waitlist preference “${input.when_hint}” for ${input.appointment_id} — no calendar sync.`,
  };
}

export type PatientCommDraftResult = {
  draft_id: string;
  channel: "sms" | "email";
  body: string;
};

/** Draft only — does not send SMS/email. */
export function stubPatientCommDraft(input: {
  channel: "sms" | "email";
  purpose: string;
  who?: string;
  when?: string;
}): PatientCommDraftResult {
  const id = `GH-DRAFT-${randomBytes(2).toString("hex").toUpperCase()}`;
  const who = input.who?.trim() || "Patient";
  const body =
    input.channel === "sms"
      ? `Hi ${who}, this is Greens Health: ${input.purpose}. ${input.when ? `Re: ${input.when}. ` : ""}Reply STOP to opt out. [demo — not sent]`
      : `Subject: Greens Health — ${input.purpose}\n\nDear ${who},\n\n${input.purpose}.\n${input.when ? `Timing: ${input.when}\n` : ""}\n— Coordinator (draft only)\n`;
  return { draft_id: id, channel: input.channel, body };
}

export type CareNavResult = {
  route_id: string;
  team: string;
  rationale: string;
};

export function stubCareNavigation(input: { text: string }): CareNavResult {
  const t = input.text.toLowerCase();
  const id = `GH-NAV-${randomBytes(2).toString("hex").toUpperCase()}`;
  if (/\b(bill|reimburse|claim|prior auth)\b/.test(t)) {
    return { route_id: id, team: "billing", rationale: "Keywords suggest billing / reimbursement." };
  }
  if (/\b(device|cuff|ship|fedex|supply)\b/.test(t)) {
    return { route_id: id, team: "logistics", rationale: "Device or shipment context." };
  }
  if (/\b(rpm|vitals|readings)\b/.test(t)) {
    return { route_id: id, team: "rpm_nurse", rationale: "RPM clinical follow-up." };
  }
  if (/\b(ccm|care plan|chronic)\b/.test(t)) {
    return { route_id: id, team: "ccm_coordinator", rationale: "CCM program coordination." };
  }
  return { route_id: id, team: "care_coordination_queue", rationale: "Default routing table (stub)." };
}

export type IntakeBundleResult = {
  bundle_id: string;
  note: string;
};

export function stubSubmitIntakeBundle(input: {
  meds: string;
  allergies: string;
  pharmacy: string;
}): IntakeBundleResult {
  return {
    bundle_id: `GH-INTAKE-${randomBytes(3).toString("hex").toUpperCase()}`,
    note: "Intake bundle stored in prototype SQLite only — not written to an EHR.",
  };
}

export type EhrNoteStubResult = {
  ref: string;
  note: string;
};

export function stubSyncNoteToEhr(input: { summary: string }): EhrNoteStubResult {
  return {
    ref: `GH-EHRNOTE-${randomBytes(2).toString("hex").toUpperCase()}`,
    note: `Would sync: ${input.summary.slice(0, 120)}…`,
  };
}

export type TaskRouteResult = {
  task_id: string;
  queue: string;
};

export function stubLogInternalTask(input: {
  what?: string;
  who?: string;
  raw_notes?: string;
}): TaskRouteResult {
  const id = `GH-TASK-${randomBytes(3).toString("hex").toUpperCase()}`;
  const text = `${input.what ?? ""} ${input.raw_notes ?? ""}`.toLowerCase();
  const queue = text.includes("bill") || text.includes("reimburse")
    ? "billing_queue"
    : text.includes("suppl") || text.includes("cuff")
      ? "logistics_queue"
      : "care_coordination_queue";
  return { task_id: id, queue };
}
