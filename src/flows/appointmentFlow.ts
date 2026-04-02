import type { AppointmentFlowState } from "../types.js";
import type { EntityMap } from "../types.js";
import { stubAppointmentChange, stubWaitlistRequest } from "../tools.js";

function detectAction(text: string): AppointmentFlowState["action"] | undefined {
  const t = text.toLowerCase();
  if (/\bcancel\b|\bcancellation\b/.test(t)) return "cancel";
  if (/\breschedule\b|\brescheduling\b/.test(t)) return "reschedule";
  if (/\bwaitlist\b|\bwait list\b/.test(t)) return "waitlist";
  if (/\bmove\b.*\b(visit|appt|appointment)\b/.test(t)) return "reschedule";
  return undefined;
}

function detectAppointmentRef(text: string, entities: EntityMap): string | undefined {
  const pid = entities.patient_id?.trim();
  if (pid && /^GH-[A-Z0-9-]+$/i.test(pid)) return pid.toUpperCase();
  const m = text.match(/\bGH-[A-Z0-9-]+\b/i);
  if (m) return m[0].toUpperCase();
  const m2 = text.match(/\b(?:appt|appointment)\s*#?\s*([A-Z0-9-]{4,})\b/i);
  if (m2) return m2[1].toUpperCase();
  return undefined;
}

function needsWhen(action: AppointmentFlowState["action"]): boolean {
  return action === "reschedule" || action === "waitlist";
}

function parsePrefill(text: string, entities: EntityMap): AppointmentFlowState {
  return {
    action: detectAction(text) ?? detectAction(`${entities.what ?? ""} ${entities.raw_notes ?? ""}`),
    appointment_id: detectAppointmentRef(text, entities),
    when_hint: entities.when?.trim(),
  };
}

function normalizeIdFallback(t: string): string {
  const x = t.trim().replace(/\s+/g, "-").toUpperCase();
  return x.slice(0, 48) || "UNKNOWN-REF";
}

export type AppointmentFlowResult = {
  message: string;
  flow: AppointmentFlowState | null;
};

/**
 * Multi-turn reschedule / cancel / waitlist. If `existing` is set, the user message fills the next missing slot.
 */
export function advanceAppointmentFlow(
  existing: AppointmentFlowState | undefined,
  userText: string,
  entities: EntityMap,
): AppointmentFlowResult {
  let flow: AppointmentFlowState = existing ? { ...existing } : parsePrefill(userText, entities);

  if (existing) {
    const t = userText.trim();
    if (!flow.action) {
      flow.action = detectAction(t);
    } else if (!flow.appointment_id) {
      flow.appointment_id = detectAppointmentRef(t, {}) ?? normalizeIdFallback(t);
    } else if (needsWhen(flow.action) && !(flow.when_hint ?? "").trim()) {
      flow.when_hint = t;
    }
  }

  if (!flow.action) {
    return {
      message:
        "Reply with *cancel*, *reschedule*, or *waitlist* for the appointment change (demo stub).",
      flow,
    };
  }

  if (!flow.appointment_id) {
    return {
      message:
        "Send the *appointment or patient reference* (e.g. `GH-4412`). _No live EHR lookup in this build._",
      flow,
    };
  }

  if (needsWhen(flow.action) && !(flow.when_hint ?? "").trim()) {
    return {
      message: "What *time or window* should we use? (e.g. next Wednesday 2pm)",
      flow,
    };
  }

  const when = (flow.when_hint ?? "").trim() || "—";
  if (flow.action === "waitlist") {
    const w = stubWaitlistRequest({
      appointment_id: flow.appointment_id,
      when_hint: when,
      raw_notes: entities.raw_notes ?? userText,
    });
    return {
      message:
        `*Waitlist (stub: \`waitlist_request\`)*\n` +
        `• Request ID: \`${w.request_id}\`\n` +
        `• Ref: \`${flow.appointment_id}\`\n` +
        `• Preference: ${when}\n` +
        `_${w.note}_`,
      flow: null,
    };
  }

  const r = stubAppointmentChange({
    action: flow.action,
    appointment_id: flow.appointment_id,
    when_hint: when,
    raw_notes: entities.raw_notes ?? userText,
  });
  return {
    message:
      `*Appointment change (stub: \`appointment_change\`)*\n` +
      `• Change ID: \`${r.change_id}\`\n` +
      `• Action: \`${flow.action}\`\n` +
      `• Ref: \`${flow.appointment_id}\`\n` +
      `• When / context: ${when}\n` +
      `_${r.ehr_stub}_`,
    flow: null,
  };
}
