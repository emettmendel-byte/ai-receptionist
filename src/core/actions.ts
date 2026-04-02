import { loadClinicConfig } from "../availability.js";
import { randomUUID } from "node:crypto";
import { formatSlotsForSlack, pickOpenSlotForBooking } from "../calendarSlots.js";
import { config } from "../config.js";
import { claimIdempotency, completeIdempotency } from "../integrations/idempotency.js";
import { enqueueIntegrationEvent } from "../integrations/outbox.js";
import { getIntegrationProvider } from "../integrations/registry.js";
import { withProviderReliability } from "../integrations/reliability.js";
import type {
  AppointmentChangeRequest,
  PatientMessageDraftRequest,
  ProviderContext,
} from "../integrations/types.js";
import { assertAuthorized } from "../security.js";

type ActionContext = ProviderContext & { idempotencyKey?: string };

type CoreReply<T> = { ok: true; data: T } | { ok: false; error: string };
const isShadowMode = () => config.pilotMode.toLowerCase() === "shadow";

export async function getAvailabilityAction(ctx: ActionContext): Promise<
  CoreReply<{
    slots: { key: string; label: string; timezone: string }[];
    summary: string;
  }>
> {
  if (!config.featureAvailability) return { ok: false, error: "availability_disabled" };
  assertAuthorized(ctx.authorizationScopes, "availability:read");
  const provider = getIntegrationProvider();
  const slots = await withProviderReliability("availability", () => provider.listAvailability(ctx));
  return {
    ok: true,
    data: {
      slots,
      summary: formatSlotsForSlack(slots.map((s) => ({ key: s.key, label: s.label }))),
    },
  };
}

export async function bookAppointmentAction(
  ctx: ActionContext,
  input: { rawText: string; whenHint?: string; patientRef?: string | null; visitType?: string | null },
): Promise<CoreReply<{ appointmentId: string; pickedLabel: string }>> {
  if (!config.featureBooking) return { ok: false, error: "booking_disabled" };
  assertAuthorized(ctx.authorizationScopes, "booking:write");
  const provider = getIntegrationProvider();
  const open = await withProviderReliability("availability", () => provider.listAvailability(ctx));
  const picked = pickOpenSlotForBooking(
    input.rawText,
    input.whenHint,
    open.map((x) => ({ key: x.key, label: x.label })),
  );
  if (!picked) return { ok: false, error: "slot_not_found" };

  const idem = ctx.idempotencyKey?.trim();
  if (idem) {
    const claim = claimIdempotency("book", idem);
    if (claim.status === "duplicate_in_progress") return { ok: false, error: "duplicate_in_progress" };
    if (claim.status === "replay") return claim.response as CoreReply<{ appointmentId: string; pickedLabel: string }>;
  }

  if (isShadowMode()) {
    const simulated = {
      ok: true as const,
      data: { appointmentId: `SHADOW-${randomUUID().slice(0, 8)}`, pickedLabel: picked.label },
    };
    if (idem) completeIdempotency("book", idem, simulated);
    enqueueIntegrationEvent("appointment.book.shadow", {
      slot_label: picked.label,
      patient_ref: input.patientRef ?? null,
      session_key: ctx.sessionKey,
      actor_id: ctx.actorId,
    });
    return simulated;
  }

  const booked = await withProviderReliability("book", () =>
    provider.book(ctx, {
      slotLabel: picked.key,
      patientRef: input.patientRef,
      visitType: input.visitType,
    }),
  );
  if (!booked.ok) return { ok: false, error: booked.error.message };
  const result: CoreReply<{ appointmentId: string; pickedLabel: string }> = {
    ok: true,
    data: { appointmentId: booked.appointmentId, pickedLabel: picked.label },
  };
  if (idem) completeIdempotency("book", idem, result);
  enqueueIntegrationEvent("appointment.booked", {
    appointment_id: booked.appointmentId,
    slot_label: picked.label,
    session_key: ctx.sessionKey,
    actor_id: ctx.actorId,
  });
  return result;
}

export async function appointmentChangeAction(
  ctx: ActionContext,
  req: AppointmentChangeRequest,
): Promise<CoreReply<{ changeId: string; description: string }>> {
  if (!config.featureAppointmentChange) return { ok: false, error: "appointment_change_disabled" };
  assertAuthorized(ctx.authorizationScopes, "appointments:write");
  const provider = getIntegrationProvider();
  const op = req.action === "cancel" ? "appointment.cancel" : "appointment.change";
  const idem = ctx.idempotencyKey?.trim();
  if (idem) {
    const claim = claimIdempotency(op, idem);
    if (claim.status === "duplicate_in_progress") return { ok: false, error: "duplicate_in_progress" };
    if (claim.status === "replay") return claim.response as CoreReply<{ changeId: string; description: string }>;
  }
  if (isShadowMode()) {
    const simulated = {
      ok: true as const,
      data: {
        changeId: `SHADOW-${randomUUID().slice(0, 8)}`,
        description: `Shadow ${req.action} for ${req.publicRef}`,
      },
    };
    if (idem) completeIdempotency(op, idem, simulated);
    enqueueIntegrationEvent("appointment.change.shadow", {
      action: req.action,
      public_ref: req.publicRef,
      session_key: ctx.sessionKey,
      actor_id: ctx.actorId,
    });
    return simulated;
  }
  const changed = await withProviderReliability(op, () => provider.change(ctx, req));
  if (!changed.ok) return { ok: false, error: changed.error.message };
  const result: CoreReply<{ changeId: string; description: string }> = {
    ok: true,
    data: { changeId: changed.changeId, description: changed.description },
  };
  if (idem) completeIdempotency(op, idem, result);
  enqueueIntegrationEvent("appointment.changed", {
    change_id: changed.changeId,
    description: changed.description,
    action: req.action,
    session_key: ctx.sessionKey,
    actor_id: ctx.actorId,
  });
  return result;
}

export async function checkEligibilityAction(
  ctx: ActionContext,
  input: { patientId?: string; payer?: string; memberId?: string },
): Promise<CoreReply<{ eligibilityId: string; status: string; payer: string; detail: string }>> {
  if (!config.featureEligibility) return { ok: false, error: "eligibility_disabled" };
  assertAuthorized(ctx.authorizationScopes, "eligibility:read");
  const provider = getIntegrationProvider();
  const e = await withProviderReliability("eligibility", () =>
    provider.checkEligibility(ctx, input),
  );
  if (!e.ok) return { ok: false, error: e.error.message };
  return {
    ok: true,
    data: {
      eligibilityId: e.eligibilityId,
      status: e.status,
      payer: e.payer,
      detail: e.detail,
    },
  };
}

export async function createPatientDraftAction(
  ctx: ActionContext,
  req: PatientMessageDraftRequest,
): Promise<CoreReply<{ draftId: string; channel: "sms" | "email"; body: string }>> {
  if (!config.featurePatientDraft) return { ok: false, error: "patient_draft_disabled" };
  assertAuthorized(ctx.authorizationScopes, "patient_draft:write");
  if (isShadowMode()) {
    const result = {
      ok: true as const,
      data: {
        draftId: `SHADOW-${randomUUID().slice(0, 8)}`,
        channel: req.channel,
        body: `[shadow draft] ${req.purpose}`,
      },
    };
    enqueueIntegrationEvent("patient.draft.shadow", {
      channel: req.channel,
      purpose: req.purpose,
      session_key: ctx.sessionKey,
      actor_id: ctx.actorId,
    });
    return result;
  }
  const provider = getIntegrationProvider();
  const d = await withProviderReliability("patient_draft", () => provider.createDraft(ctx, req));
  if (!d.ok) return { ok: false, error: d.error.message };
  enqueueIntegrationEvent("patient.draft.created", {
    draft_id: d.draftId,
    channel: d.channel,
    session_key: ctx.sessionKey,
    actor_id: ctx.actorId,
  });
  return { ok: true, data: { draftId: d.draftId, channel: d.channel, body: d.body } };
}

export async function careNavigationAction(
  ctx: ActionContext,
  text: string,
): Promise<CoreReply<{ routeId: string; team: string; rationale: string }>> {
  if (!config.featureCareNavigation) return { ok: false, error: "care_navigation_disabled" };
  assertAuthorized(ctx.authorizationScopes, "care_navigation:read");
  const provider = getIntegrationProvider();
  const n = await withProviderReliability("care_navigation", () => provider.suggestTeam(ctx, text));
  if (!n.ok) return { ok: false, error: n.error.message };
  return { ok: true, data: { routeId: n.routeId, team: n.team, rationale: n.rationale } };
}

export async function routeTaskAction(
  ctx: ActionContext,
  input: { what?: string; who?: string; rawNotes?: string },
): Promise<CoreReply<{ taskId: string; queue: string }>> {
  if (!config.featureTaskRouting) return { ok: false, error: "task_routing_disabled" };
  assertAuthorized(ctx.authorizationScopes, "task_routing:write");
  if (isShadowMode()) {
    const result = {
      ok: true as const,
      data: {
        taskId: `SHADOW-${randomUUID().slice(0, 8)}`,
        queue: "shadow_queue",
      },
    };
    enqueueIntegrationEvent("task.route.shadow", {
      what: input.what ?? null,
      who: input.who ?? null,
      session_key: ctx.sessionKey,
      actor_id: ctx.actorId,
    });
    return result;
  }
  const provider = getIntegrationProvider();
  const t = await withProviderReliability("task_routing", () => provider.routeTask(ctx, input));
  if (!t.ok) return { ok: false, error: t.error.message };
  enqueueIntegrationEvent("task.routed", {
    task_id: t.taskId,
    queue: t.queue,
    session_key: ctx.sessionKey,
    actor_id: ctx.actorId,
  });
  return { ok: true, data: { taskId: t.taskId, queue: t.queue } };
}

export async function submitIntakeAction(
  ctx: ActionContext,
  intake: { meds: string; allergies: string; pharmacy: string },
): Promise<CoreReply<{ bundleId: string; ehrRef: string; note: string }>> {
  if (!config.featureIntakeSubmit) return { ok: false, error: "intake_submit_disabled" };
  assertAuthorized(ctx.authorizationScopes, "intake:write");
  if (isShadowMode()) {
    const result = {
      ok: true as const,
      data: {
        bundleId: `SHADOW-${randomUUID().slice(0, 8)}`,
        ehrRef: `SHADOW-${randomUUID().slice(0, 8)}`,
        note: "Shadow mode: intake would be submitted to EHR provider.",
      },
    };
    enqueueIntegrationEvent("intake.submit.shadow", {
      session_key: ctx.sessionKey,
      actor_id: ctx.actorId,
    });
    return result;
  }
  const provider = getIntegrationProvider();
  const out = await withProviderReliability("intake_submit", () => provider.submitIntake(ctx, intake));
  if (!out.ok) return { ok: false, error: out.error.message };
  enqueueIntegrationEvent("intake.submitted", {
    bundle_id: out.bundleId,
    ehr_ref: out.ehrRef,
    session_key: ctx.sessionKey,
    actor_id: ctx.actorId,
  });
  return { ok: true, data: { bundleId: out.bundleId, ehrRef: out.ehrRef, note: out.note } };
}

export function visitTypesSummary(): string {
  return loadClinicConfig().visit_types?.join(", ") ?? "CCM, RPM";
}
