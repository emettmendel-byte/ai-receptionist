import type { App, SayFn } from "@slack/bolt";
import { appendAudit } from "./auditLog.js";
import { getSlotSuggestions } from "./availability.js";
import { config } from "./config.js";
import { advanceAppointmentFlow } from "./flows/appointmentFlow.js";
import { continueIntakeFlow, startIntakeFlow } from "./flows/intakeFlow.js";
import { formatHandoffPackage } from "./escalation.js";
import { matchFaqSnippet } from "./faq.js";
import { classifyTurn } from "./llm/classify.js";
import { answerFaqGeneric } from "./llm/faqLlm.js";
import { logMetric } from "./metrics.js";
import { phiHeuristicFlag } from "./phiHeuristic.js";
import { matchesPolicyRedline } from "./policyRedlines.js";
import { resolvePostAt } from "./reminderParse.js";
import { scheduleSlackReminder } from "./scheduler.js";
import { appendTurn, loadSession, saveSession, sessionKey } from "./sessionStore.js";
import {
  stubCareNavigation,
  stubCheckInsuranceEligibility,
  stubCreateScheduleHold,
  stubLogInternalTask,
  stubPatientCommDraft,
} from "./tools.js";
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
    const r = advanceAppointmentFlow(state.appointment_flow, params.text, {});
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

  const classification = await classifyTurn(state.turns, params.text);
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
    client: params.app.client,
    appointment_flow: state.appointment_flow ?? undefined,
    intake_flow: state.intake_flow ?? undefined,
  });

  state.clarify_count = 0;
  if ("appointment_flow" in reply) {
    state.appointment_flow = reply.appointment_flow ?? null;
  }
  if ("intake_flow" in reply) {
    state.intake_flow = reply.intake_flow ?? null;
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
};

async function routeIntent(args: {
  classification: Classification;
  rawText: string;
  userId: string;
  channelId: string;
  threadTs: string;
  client: App["client"];
  appointment_flow?: SessionState["appointment_flow"];
  intake_flow?: SessionState["intake_flow"];
}): Promise<RouteReply> {
  const c = args.classification;
  switch (c.intent) {
    case "schedule_inquiry": {
      const slots = getSlotSuggestions({ whenHint: c.entities.when });
      const hold = stubCreateScheduleHold({
        who: c.entities.who,
        when: slots.primary,
        what: c.entities.what,
      });
      const alt = slots.alternates.map((s) => `• ${s}`).join("\n");
      return {
        text:
          `*Schedule inquiry (stub tools: \`create_schedule_hold\` + clinic rules)*\n` +
          `• Hold ID: \`${hold.hold_id}\`\n` +
          `• *Primary slot:* ${slots.primary}\n` +
          `• *Alternates:*\n${alt}\n` +
          `• Visit types (config): ${slots.visit_types.join(", ")}\n` +
          `• _${hold.ehr_stub}_\n` +
          `${slots.note}\n` +
          `Next: coordinator confirms with patient; EHR sync is not wired in this prototype.`,
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
      const t = stubLogInternalTask({
        what: c.entities.what,
        who: c.entities.who,
        raw_notes: c.entities.raw_notes ?? args.rawText,
      });
      return {
        text:
          `*Task routed (stub tool: \`log_internal_task\`)*\n` +
          `• Task ID: \`${t.task_id}\`\n` +
          `• Queue: \`${t.queue}\`\n` +
          `_Demo only — no ticket system integration._`,
      };
    }
    case "insurance_eligibility_check": {
      const e = stubCheckInsuranceEligibility({
        patient_id: c.entities.patient_id,
        payer: c.entities.payer ?? c.entities.what,
        member_id: c.entities.member_id ?? c.entities.raw_notes,
      });
      return {
        text:
          `*Insurance eligibility (stub: \`check_eligibility\`)*\n` +
          `• Eligibility ID: \`${e.eligibility_id}\`\n` +
          `• Status: \`${e.status}\`\n` +
          `• Payer: ${e.payer}\n` +
          `• ${e.detail}\n` +
          `_Not a real payer response — demo only._`,
      };
    }
    case "appointment_change": {
      const r = advanceAppointmentFlow(
        args.appointment_flow ?? undefined,
        args.rawText,
        c.entities,
      );
      return { text: r.message, appointment_flow: r.flow };
    }
    case "patient_comm_draft": {
      const t = args.rawText.toLowerCase();
      const channel = /\bemail\b/.test(t) ? "email" : "sms";
      const d = stubPatientCommDraft({
        channel,
        purpose: c.entities.what ?? c.entities.raw_notes ?? "update from your care team",
        who: c.entities.who,
        when: c.entities.when,
      });
      return {
        text:
          `*Patient message draft (stub — not sent)*\n` +
          `• Draft ID: \`${d.draft_id}\`\n` +
          `• Channel: \`${d.channel}\`\n` +
          `\`\`\`\n${d.body}\n\`\`\``,
      };
    }
    case "care_navigation": {
      const n = stubCareNavigation({ text: args.rawText });
      return {
        text:
          `*Care navigation (stub routing table)*\n` +
          `• Route ID: \`${n.route_id}\`\n` +
          `• Suggested team: \`${n.team}\`\n` +
          `• _${n.rationale}_`,
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
