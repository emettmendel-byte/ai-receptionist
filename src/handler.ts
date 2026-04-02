import type { App, SayFn } from "@slack/bolt";
import {
  bookAppointment,
  listActiveBookedSlotKeys,
} from "./appointments.js";
import { appendAudit } from "./auditLog.js";
import { loadClinicConfig } from "./availability.js";
import {
  formatSlotsForSlack,
  listOpenCalendarSlots,
  pickOpenSlotForBooking,
} from "./calendarSlots.js";
import { config } from "./config.js";
import { advanceAppointmentFlow } from "./flows/appointmentFlow.js";
import { continueIntakeFlow, startIntakeFlow } from "./flows/intakeFlow.js";
import { formatHandoffPackage } from "./escalation.js";
import { matchFaqSnippet, matchReceptionistCapabilities } from "./faq.js";
import { classifyTurn } from "./llm/classify.js";
import { answerFaqGeneric } from "./llm/faqLlm.js";
import { logMetric } from "./metrics.js";
import { phiHeuristicFlag } from "./phiHeuristic.js";
import { matchesPolicyRedline } from "./policyRedlines.js";
import { patchSchedulingClassification, shouldCommitBooking } from "./scheduleRouting.js";
import { resolvePostAt } from "./reminderParse.js";
import { scheduleSlackReminder } from "./scheduler.js";
import { appendTurn, loadSession, saveSession, sessionKey } from "./sessionStore.js";
import {
  bookAppointmentAction,
  careNavigationAction,
  checkEligibilityAction,
  createPatientDraftAction,
  getAvailabilityAction,
  routeTaskAction,
  visitTypesSummary,
} from "./core/actions.js";
import type { Classification, SessionState } from "./types.js";

function parentThreadTs(threadTs: string | undefined, messageTs: string | undefined): string {
  return threadTs ?? messageTs ?? "";
}

function audit(
  key: string,
  userId: string,
  classification: Classification,
  path: string,
  actionSummary: string,
  text: string,
): void {
  appendAudit({
    session_key: key,
    user_id: userId,
    intent: classification.intent,
    confidence: classification.confidence,
    path,
    phi_flag: phiHeuristicFlag(text),
    action_summary: actionSummary,
    text_preview: text,
  });
}

async function escalate(args: {
  say: SayFn;
  client: App["client"];
  channelId: string;
  threadTs: string;
  userId: string;
  text: string;
  classification: Classification;
  summaryLines: string[];
  startedAt: string;
  metricPath: "escalation" | "policy_escalation";
}): Promise<void> {
  const pkg = formatHandoffPackage({
    summaryLines: args.summaryLines,
    classification: args.classification,
    latestUserText: args.text,
    channelId: args.channelId,
    threadTs: args.threadTs,
    workspaceDomain: process.env.SLACK_WORKSPACE_DOMAIN,
  });
  await args.say({ text: pkg, thread_ts: args.threadTs });

  if (config.escalationChannelId) {
    try {
      await args.client.chat.postMessage({
        channel: config.escalationChannelId,
        text: pkg,
      });
    } catch {
      /* optional channel */
    }
  }

  const replied = new Date().toISOString();
  logMetric({
    session_key: sessionKey(args.userId, args.threadTs),
    intent: args.classification.intent,
    confidence: args.classification.confidence,
    started_at: args.startedAt,
    replied_at: replied,
    latency_ms: Date.now() - Date.parse(args.startedAt),
    path: args.metricPath,
  });

  audit(
    sessionKey(args.userId, args.threadTs),
    args.userId,
    args.classification,
    args.metricPath,
    args.summaryLines.join(" | ") || "handoff",
    args.text,
  );
}

export async function handleUserMessage(params: {
  app: App;
  bodyUserId: string;
  text: string;
  channelId: string;
  messageTs: string;
  threadTs: string | undefined;
  say: SayFn;
}): Promise<void> {
  const startedAt = new Date().toISOString();
  const pThread = parentThreadTs(params.threadTs, params.messageTs);
  const key = sessionKey(params.bodyUserId, pThread);

  let state = loadSession(key);
  if (state.turns.length >= config.maxTurns) {
    await escalate({
      say: params.say,
      client: params.app.client,
      channelId: params.channelId,
      threadTs: pThread,
      userId: params.bodyUserId,
      text: params.text,
      classification: {
        intent: "human_escalation",
        confidence: 1,
        entities: { raw_notes: "session turn limit" },
        needs_clarification: false,
      },
      summaryLines: ["Session hit max turns for the prototype guardrail."],
      startedAt,
      metricPath: "escalation",
    });
    return;
  }

  appendTurn(key, "user", params.text);
  state = loadSession(key);

  const policy = matchesPolicyRedline(params.text);
  if (policy.hit) {
    saveSession(key, { ...state, clarify_count: 0, appointment_flow: null, intake_flow: null });
    await escalate({
      say: params.say,
      client: params.app.client,
      channelId: params.channelId,
      threadTs: pThread,
      userId: params.bodyUserId,
      text: params.text,
      classification: {
        intent: "human_escalation",
        confidence: 1,
        entities: { raw_notes: policy.reason ?? "policy redline" },
        needs_clarification: false,
        rationale: "Policy redline short-circuit (demo)",
      },
      summaryLines: [
        "Policy redline matched — forced human handoff (prototype).",
        policy.reason ?? "",
      ].filter(Boolean),
      startedAt,
      metricPath: "policy_escalation",
    });
    appendTurn(key, "assistant", "[handoff posted — policy redline]");
    return;
  }

  if (state.appointment_flow) {
    const r = advanceAppointmentFlow(
      state.appointment_flow,
      params.text,
      {},
      state.last_booked_appointment_id ?? null,
    );
    state.appointment_flow = r.flow ?? null;
    state.clarify_count = 0;
    saveSession(key, state);
    await params.say({ text: r.message, thread_ts: pThread });
    appendTurn(key, "assistant", r.message);
    const replied = new Date().toISOString();
    logMetric({
      session_key: key,
      intent: "appointment_change",
      confidence: 1,
      started_at: startedAt,
      replied_at: replied,
      latency_ms: Date.now() - Date.parse(startedAt),
      path: "automated",
    });
    audit(key, params.bodyUserId, {
      intent: "appointment_change",
      confidence: 1,
      entities: {},
      needs_clarification: false,
    }, "automated", "appointment_flow_step", params.text);
    return;
  }

  if (state.intake_flow) {
    const r = continueIntakeFlow(state.intake_flow, params.text);
    state.intake_flow = r.flow ?? null;
    state.clarify_count = 0;
    saveSession(key, state);
    await params.say({ text: r.message, thread_ts: pThread });
    appendTurn(key, "assistant", r.message);
    const replied = new Date().toISOString();
    logMetric({
      session_key: key,
      intent: "pre_visit_intake",
      confidence: 1,
      started_at: startedAt,
      replied_at: replied,
      latency_ms: Date.now() - Date.parse(startedAt),
      path: "automated",
    });
    audit(key, params.bodyUserId, {
      intent: "pre_visit_intake",
      confidence: 1,
      entities: {},
      needs_clarification: false,
    }, "automated", "intake_flow_step", params.text);
    return;
  }

  const capabilitiesReply = matchReceptionistCapabilities(params.text);
  if (capabilitiesReply) {
    state.clarify_count = 0;
    state.last_intent = "faq";
    saveSession(key, state);
    await params.say({ text: capabilitiesReply, thread_ts: pThread });
    appendTurn(key, "assistant", capabilitiesReply);
    const capClassification: Classification = {
      intent: "faq",
      confidence: 1,
      entities: { raw_notes: "capabilities_overview" },
      needs_clarification: false,
      rationale: "Matched meta/capabilities patterns (not schedule_inquiry)",
    };
    const replied = new Date().toISOString();
    logMetric({
      session_key: key,
      intent: "faq",
      confidence: 1,
      started_at: startedAt,
      replied_at: replied,
      latency_ms: Date.now() - Date.parse(startedAt),
      path: "automated",
    });
    audit(key, params.bodyUserId, capClassification, "automated", "capabilities_overview", params.text);
    return;
  }

  let classification = await classifyTurn(state.turns, params.text);
  classification = patchSchedulingClassification(params.text, classification);
  state.last_intent =
    classification.intent !== "unknown" ? classification.intent : state.last_intent;

  const lowConfidence =
    classification.intent !== "human_escalation" &&
    (classification.confidence < config.confidenceThreshold ||
      classification.intent === "unknown");

  if (classification.intent === "human_escalation" || lowConfidence) {
    const lines =
      classification.intent === "human_escalation"
        ? (["User requested human escalation.", classification.rationale].filter(Boolean) as string[])
        : [
            "Low confidence or unknown intent — routing for human review.",
            classification.rationale,
          ].filter(Boolean) as string[];

    saveSession(key, { ...state, clarify_count: 0 });
    await escalate({
      say: params.say,
      client: params.app.client,
      channelId: params.channelId,
      threadTs: pThread,
      userId: params.bodyUserId,
      text: params.text,
      classification,
      summaryLines: lines,
      startedAt,
      metricPath: "escalation",
    });
    appendTurn(key, "assistant", "[handoff posted]");
    return;
  }

  if (classification.needs_clarification && state.clarify_count >= config.maxClarify) {
    saveSession(key, { ...state, clarify_count: 0 });
    await escalate({
      say: params.say,
      client: params.app.client,
      channelId: params.channelId,
      threadTs: pThread,
      userId: params.bodyUserId,
      text: params.text,
      classification,
      summaryLines: ["Exceeded clarification rounds; human needed to unblock."],
      startedAt,
      metricPath: "escalation",
    });
    appendTurn(key, "assistant", "[handoff posted]");
    return;
  }

  if (classification.needs_clarification && classification.clarification_question) {
    state.clarify_count += 1;
    saveSession(key, state);
    await params.say({
      text: classification.clarification_question,
      thread_ts: pThread,
    });
    appendTurn(key, "assistant", classification.clarification_question);
    const replied = new Date().toISOString();
    logMetric({
      session_key: key,
      intent: classification.intent,
      confidence: classification.confidence,
      started_at: startedAt,
      replied_at: replied,
      latency_ms: Date.now() - Date.parse(startedAt),
      path: "clarify",
    });
    audit(key, params.bodyUserId, classification, "clarify", "asked_clarification", params.text);
    return;
  }

  const reply = await routeIntent({
    classification,
    rawText: params.text,
    userId: params.bodyUserId,
    channelId: params.channelId,
    threadTs: pThread,
    sessionKey: key,
    client: params.app.client,
    messageTs: params.messageTs,
    appointment_flow: state.appointment_flow ?? undefined,
    intake_flow: state.intake_flow ?? undefined,
    lastBookedAppointmentId: state.last_booked_appointment_id ?? undefined,
  });

  state.clarify_count = 0;
  if ("appointment_flow" in reply) {
    state.appointment_flow = reply.appointment_flow ?? null;
  }
  if ("intake_flow" in reply) {
    state.intake_flow = reply.intake_flow ?? null;
  }
  if (reply.last_booked_appointment_id !== undefined) {
    state.last_booked_appointment_id = reply.last_booked_appointment_id;
  }
  saveSession(key, state);
  await params.say({ text: reply.text, thread_ts: pThread });
  appendTurn(key, "assistant", reply.text);

  const replied = new Date().toISOString();
  logMetric({
    session_key: key,
    intent: classification.intent,
    confidence: classification.confidence,
    started_at: startedAt,
    replied_at: replied,
    latency_ms: Date.now() - Date.parse(startedAt),
    path: "automated",
  });
  audit(
    key,
    params.bodyUserId,
    classification,
    "automated",
    `routed:${classification.intent}`,
    params.text,
  );
}

type RouteReply = {
  text: string;
  appointment_flow?: SessionState["appointment_flow"];
  intake_flow?: SessionState["intake_flow"];
  last_booked_appointment_id?: string | null;
};

async function routeIntent(args: {
  classification: Classification;
  rawText: string;
  userId: string;
  channelId: string;
  threadTs: string;
  sessionKey: string;
  client: App["client"];
  messageTs: string;
  appointment_flow?: SessionState["appointment_flow"];
  intake_flow?: SessionState["intake_flow"];
  lastBookedAppointmentId?: string | null;
}): Promise<RouteReply> {
  const c = args.classification;
  switch (c.intent) {
    case "availability_inquiry": {
      const avail = await getAvailabilityAction({
        sessionKey: args.sessionKey,
        actorId: args.userId,
        authorizationScopes: ["availability:read"],
      });
      if (!avail.ok) {
        return { text: `Could not fetch availability (${avail.error}).` };
      }
      return {
        text:
          `*Open appointments* (demo calendar, ${loadClinicConfig().timezone ?? "America/New_York"})\n` +
          `_These are generated from clinic blocks in config — not a live EHR calendar._\n\n` +
          `${avail.data.summary}\n\n` +
          `Visit types: ${visitTypesSummary()}\n` +
          `_To **book**, say e.g. *Book me* + copy a line above, or *Schedule me for Monday morning*._`,
      };
    }
    case "schedule_inquiry": {
      const avail = await getAvailabilityAction({
        sessionKey: args.sessionKey,
        actorId: args.userId,
        authorizationScopes: ["availability:read"],
      });
      if (!avail.ok) return { text: `Could not fetch availability (${avail.error}).` };
      const open = avail.data.slots.map((x) => ({ key: x.key, label: x.label }));
      const picked = pickOpenSlotForBooking(args.rawText, c.entities.when, open);

      if (!shouldCommitBooking(args.rawText, picked)) {
        return {
          text:
            `*Not booking yet* — I only reserve a slot when you ask to *book* / *schedule* / *reserve* (or paste a specific time from the list).\n\n` +
            `*Currently open times:*\n${formatSlotsForSlack(open)}\n\n` +
            `_Example: *Book me on Mon Apr 7 at 10:30am* or *Schedule an appointment for patient GH-1234 Tuesday afternoon*._`,
        };
      }

      if (!picked) {
        return {
          text:
            `*Pick a concrete time*\n` +
            `I couldn’t match that to an open slot. Choose one of these (then say *book* + the line):\n\n` +
            `${formatSlotsForSlack(open)}`,
        };
      }

      const patientRef =
        c.entities.patient_id?.trim() || c.entities.who?.trim() || null;
      const book = await bookAppointmentAction({
        sessionKey: args.sessionKey,
        actorId: args.userId,
        authorizationScopes: ["booking:write", "availability:read"],
        idempotencyKey: `${args.messageTs}:schedule_inquiry`,
      }, {
        rawText: args.rawText,
        whenHint: c.entities.when,
        patientRef,
        visitType: c.entities.what?.trim() || null,
      });

      if (!book.ok) {
        if (book.error.includes("slot")) {
          return {
            text:
              `That slot was just taken — try another line from *open times* or ask what’s *available*.`,
          };
        }
        return { text: `Could not book (${book.error}).` };
      }

      const bookedNow = listActiveBookedSlotKeys();
      const remaining = listOpenCalendarSlots({ bookedSlotLabels: bookedNow });
      const alt = formatSlotsForSlack(remaining, 5);

      return {
        text:
          `*Appointment booked* (SQLite ledger)\n` +
          `• Appointment ID: \`${book.data.appointmentId}\`\n` +
          `• Time: _${book.data.pickedLabel}_ (held in the demo calendar)\n` +
          `• Patient / ref: ${patientRef ? `\`${patientRef}\`` : "_not specified — include GH-xxxx next time_"}\n` +
          `• Visit context: ${c.entities.what?.trim() || "_general inquiry_"}\n` +
          `• Visit types (config): ${visitTypesSummary()}\n\n` +
          `*Other open times:*\n${alt}\n\n` +
          `_Cancel / reschedule: use \`GH-APT-…\` or say *reschedule this appointment* in this thread._`,
        last_booked_appointment_id: book.data.appointmentId,
      };
    }
    case "reminder_trigger": {
      const sched = resolvePostAt({
        when_iso: c.entities.when_iso,
        when: c.entities.when ?? args.rawText,
      });
      if (!sched) {
        return {
          text:
            "I can schedule a Slack reminder — tell me a relative time like *in 2 minutes* or *in 90 seconds*, " +
            "or give an ISO time (demo).",
        };
      }
      const remindText =
        c.entities.what?.trim() ||
        `Reminder for <@${args.userId}>: follow-up (from thread ${args.threadTs})`;
      const { jobId, scheduledMessageId } = await scheduleSlackReminder(args.client, {
        channelId: args.channelId,
        threadTs: args.threadTs,
        postAt: sched.postAt,
        text: `:alarm_clock: ${remindText}`,
        userId: args.userId,
      });
      return {
        text:
          `*Reminder scheduled* (${sched.label})\n` +
          `• Job ID: \`${jobId}\`\n` +
          `• Slack scheduled message ID: \`${scheduledMessageId}\`\n` +
          `_Uses \`chat.scheduleMessage\` — Slack delivers at \`${sched.postAt}\` (unix)._`,
      };
    }
    case "faq": {
      const snippet = matchFaqSnippet(args.rawText);
      const body = snippet ?? (await answerFaqGeneric(args.rawText));
      return { text: `*FAQ*\n${body}` };
    }
    case "task_routing": {
      const t = await routeTaskAction({
        sessionKey: args.sessionKey,
        actorId: args.userId,
        authorizationScopes: ["task_routing:write"],
      }, {
        what: c.entities.what,
        who: c.entities.who,
        rawNotes: c.entities.raw_notes ?? args.rawText,
      });
      if (!t.ok) return { text: `Could not route task (${t.error}).` };
      return {
        text:
          `*Task routed (stub tool: \`log_internal_task\`)*\n` +
          `• Task ID: \`${t.data.taskId}\`\n` +
          `• Queue: \`${t.data.queue}\`\n` +
          `_Demo only — no ticket system integration._`,
      };
    }
    case "insurance_eligibility_check": {
      const e = await checkEligibilityAction({
        sessionKey: args.sessionKey,
        actorId: args.userId,
        authorizationScopes: ["eligibility:read"],
      }, {
        patientId: c.entities.patient_id,
        payer: c.entities.payer ?? c.entities.what,
        memberId: c.entities.member_id ?? c.entities.raw_notes,
      });
      if (!e.ok) return { text: `Could not check eligibility (${e.error}).` };
      return {
        text:
          `*Insurance eligibility (stub: \`check_eligibility\`)*\n` +
          `• Eligibility ID: \`${e.data.eligibilityId}\`\n` +
          `• Status: \`${e.data.status}\`\n` +
          `• Payer: ${e.data.payer}\n` +
          `• ${e.data.detail}\n` +
          `_Not a real payer response — demo only._`,
      };
    }
    case "appointment_change": {
      const r = advanceAppointmentFlow(
        args.appointment_flow ?? undefined,
        args.rawText,
        c.entities,
        args.lastBookedAppointmentId ?? null,
      );
      return { text: r.message, appointment_flow: r.flow };
    }
    case "patient_comm_draft": {
      const t = args.rawText.toLowerCase();
      const channel = /\bemail\b/.test(t) ? "email" : "sms";
      const d = await createPatientDraftAction({
        sessionKey: args.sessionKey,
        actorId: args.userId,
        authorizationScopes: ["patient_draft:write"],
      }, {
        channel,
        purpose: c.entities.what ?? c.entities.raw_notes ?? "update from your care team",
        who: c.entities.who,
        when: c.entities.when,
      });
      if (!d.ok) return { text: `Could not draft patient communication (${d.error}).` };
      return {
        text:
          `*Patient message draft (stub — not sent)*\n` +
          `• Draft ID: \`${d.data.draftId}\`\n` +
          `• Channel: \`${d.data.channel}\`\n` +
          `\`\`\`\n${d.data.body}\n\`\`\``,
      };
    }
    case "care_navigation": {
      const n = await careNavigationAction({
        sessionKey: args.sessionKey,
        actorId: args.userId,
        authorizationScopes: ["care_navigation:read"],
      }, args.rawText);
      if (!n.ok) return { text: `Could not route care navigation (${n.error}).` };
      return {
        text:
          `*Care navigation (stub routing table)*\n` +
          `• Route ID: \`${n.data.routeId}\`\n` +
          `• Suggested team: \`${n.data.team}\`\n` +
          `• _${n.data.rationale}_`,
      };
    }
    case "pre_visit_intake": {
      const started = startIntakeFlow();
      return { text: started.message, intake_flow: started.flow };
    }
    default: {
      return { text: "Unhandled intent in router (prototype)." };
    }
  }
}
