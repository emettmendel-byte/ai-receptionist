import {
  bookAppointment,
  cancelAppointmentByRef,
  listActiveBookedSlotKeys,
  rescheduleAppointmentByRef,
} from "../appointments.js";
import { listOpenCalendarSlots } from "../calendarSlots.js";
import {
  stubCareNavigation,
  stubCheckInsuranceEligibility,
  stubLogInternalTask,
  stubPatientCommDraft,
  stubSubmitIntakeBundle,
  stubSyncNoteToEhr,
  stubWaitlistRequest,
} from "../tools.js";
import type {
  AppointmentChangeRequest,
  AppointmentChangeResult,
  BookingRequest,
  BookingResult,
  EligibilityRequest,
  EligibilityResult,
  IntegrationProvider,
  PatientMessageDraftRequest,
  PatientMessageDraftResult,
  ProviderContext,
  TaskRoutingResult,
  CareNavigationResult,
  IntakeBundle,
  IntakeSubmitResult,
} from "./types.js";

function userFixable(code: string, message: string) {
  return { kind: "user_fixable" as const, code, message };
}

export const stubIntegrationProvider: IntegrationProvider = {
  name: "stub",
  capabilities: {
    booking: true,
    eligibility: true,
    patientDraft: true,
    careNavigation: true,
    taskRouting: true,
    intakeSubmit: true,
  },

  async listAvailability(_ctx: ProviderContext) {
    const open = listOpenCalendarSlots({ bookedSlotLabels: listActiveBookedSlotKeys() });
    return open.map((x) => ({
      key: x.key,
      label: x.label,
      timezone: "America/New_York",
    }));
  },

  async book(ctx: ProviderContext, req: BookingRequest): Promise<BookingResult> {
    const b = bookAppointment({
      slotLabel: req.slotLabel,
      patientRef: req.patientRef,
      visitType: req.visitType,
      sessionKey: ctx.sessionKey,
      userId: ctx.actorId,
    });
    if (!b.ok) {
      return { ok: false, error: userFixable(b.reason, `Booking failed (${b.reason}).`) };
    }
    return { ok: true, appointmentId: b.id, slotLabel: b.slot_label };
  },

  async change(_ctx: ProviderContext, req: AppointmentChangeRequest): Promise<AppointmentChangeResult> {
    if (req.action === "cancel") {
      const r = cancelAppointmentByRef(req.publicRef);
      if (!r.ok) {
        return { ok: false, error: userFixable(r.reason, `Cancel failed (${r.reason}).`) };
      }
      return { ok: true, changeId: r.id, description: `Cancelled ${r.slot_label}` };
    }
    if (req.action === "reschedule") {
      const r = rescheduleAppointmentByRef(req.publicRef, req.newSlotLabel);
      if (!r.ok) {
        return { ok: false, error: userFixable(r.reason, `Reschedule failed (${r.reason}).`) };
      }
      return { ok: true, changeId: r.change_id, description: `Rescheduled to ${r.new_slot}` };
    }
    const w = stubWaitlistRequest({
      appointment_id: req.publicRef,
      when_hint: req.whenHint,
      raw_notes: req.rawNotes,
    });
    return { ok: true, changeId: w.request_id, description: w.note };
  },

  async checkEligibility(_ctx: ProviderContext, req: EligibilityRequest): Promise<EligibilityResult> {
    const e = stubCheckInsuranceEligibility({
      patient_id: req.patientId,
      payer: req.payer,
      member_id: req.memberId,
    });
    return {
      ok: true,
      eligibilityId: e.eligibility_id,
      status: e.status,
      payer: e.payer,
      detail: e.detail,
    };
  },

  async createDraft(
    _ctx: ProviderContext,
    req: PatientMessageDraftRequest,
  ): Promise<PatientMessageDraftResult> {
    const d = stubPatientCommDraft(req);
    return { ok: true, draftId: d.draft_id, channel: d.channel, body: d.body };
  },

  async suggestTeam(_ctx: ProviderContext, question: string): Promise<CareNavigationResult> {
    const n = stubCareNavigation({ text: question });
    return { ok: true, routeId: n.route_id, team: n.team, rationale: n.rationale };
  },

  async routeTask(
    _ctx: ProviderContext,
    req: { what?: string; who?: string; rawNotes?: string },
  ): Promise<TaskRoutingResult> {
    const t = stubLogInternalTask({
      what: req.what,
      who: req.who,
      raw_notes: req.rawNotes,
    });
    return { ok: true, taskId: t.task_id, queue: t.queue };
  },

  async submitIntake(_ctx: ProviderContext, intake: IntakeBundle): Promise<IntakeSubmitResult> {
    const b = stubSubmitIntakeBundle(intake);
    const note = stubSyncNoteToEhr({ summary: `Pre-visit intake bundle ${b.bundle_id}` });
    return { ok: true, bundleId: b.bundle_id, ehrRef: note.ref, note: b.note };
  },
};
