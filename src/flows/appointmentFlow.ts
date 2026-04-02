import {
  cancelAppointmentByRef,
  listActiveBookedSlotKeys,
  rescheduleAppointmentByRef,
} from "../appointments.js";
import { listOpenCalendarSlots, pickOpenSlotForRescheduleHint } from "../calendarSlots.js";
import type { AppointmentFlowState } from "../types.js";
import type { EntityMap } from "../types.js";
import { stubWaitlistRequest } from "../tools.js";

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
  const mapt = text.match(/\bGH-APT-[A-F0-9]+\b/i);
  if (mapt) return mapt[0].toUpperCase();
  return undefined;
}

function needsWhen(action: AppointmentFlowState["action"]): boolean {
  return action === "reschedule" || action === "waitlist";
}

function parsePrefill(
  text: string,
  entities: EntityMap,
  lastBookedAppointmentId?: string | null,
): AppointmentFlowState {
  return {
    action: detectAction(text) ?? detectAction(`${entities.what ?? ""} ${entities.raw_notes ?? ""}`),
    appointment_id:
      detectAppointmentRef(text, entities) ?? (lastBookedAppointmentId?.trim() || undefined),
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
  lastBookedAppointmentId?: string | null,
): AppointmentFlowResult {
  let flow: AppointmentFlowState = existing
    ? { ...existing }
    : parsePrefill(userText, entities, lastBookedAppointmentId);

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

  const whenRaw = (flow.when_hint ?? "").trim() || "—";
  if (flow.action === "waitlist") {
    const w = stubWaitlistRequest({
      appointment_id: flow.appointment_id,
      when_hint: whenRaw,
      raw_notes: entities.raw_notes ?? userText,
    });
    return {
      message:
        `*Waitlist (stub: \`waitlist_request\`)*\n` +
        `• Request ID: \`${w.request_id}\`\n` +
        `• Ref: \`${flow.appointment_id}\`\n` +
        `• Preference: ${whenRaw}\n` +
        `_${w.note}_`,
      flow: null,
    };
  }

  if (flow.action === "cancel") {
    const cr = cancelAppointmentByRef(flow.appointment_id);
    if (!cr.ok) {
      return {
        message:
          `No *active* appointment found for \`${flow.appointment_id}\`. ` +
          `Use the \`GH-APT-…\` id from your booking confirmation, or the patient ref \`GH-xxxx\` if it was stored.`,
        flow: null,
      };
    }
    return {
      message:
        `*Appointment cancelled*\n` +
        `• ID: \`${cr.id}\`\n` +
        `• Released slot: _${cr.slot_label}_\n` +
        `_Slot is free again in the local SQLite ledger (demo)._`,
      flow: null,
    };
  }

  const open = listOpenCalendarSlots({ bookedSlotLabels: listActiveBookedSlotKeys() });
  const picked = pickOpenSlotForRescheduleHint(whenRaw, open);
  if (!picked) {
    return {
      message:
        `No matching *open* slot in the demo calendar for “${whenRaw}”. ` +
        `Try another day (e.g. next Monday afternoon) or ask for *available times* first.`,
      flow,
    };
  }

  const rr = rescheduleAppointmentByRef(flow.appointment_id, picked.key);
  if (!rr.ok) {
    if (rr.reason === "slot_taken") {
      return {
        message:
          `That time is *already booked*. Send a different window (e.g. another day or pick from open template slots).`,
        flow,
      };
    }
    return {
      message:
        `Could not reschedule \`${flow.appointment_id}\` — not found or invalid time. ` +
        `Confirm the \`GH-APT-…\` id or patient ref.`,
      flow: null,
    };
  }

  return {
    message:
      `*Appointment rescheduled*\n` +
      `• ID: \`${rr.id}\`\n` +
      `• Change ref: \`${rr.change_id}\`\n` +
      `• New time: _${picked.label}_\n` +
      `_Updated in local SQLite; EHR not connected._`,
    flow: null,
  };
}
