import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookAppointment } from "../src/appointments.js";
import { closeDb } from "../src/db.js";
import { formatHandoffPackage } from "../src/escalation.js";
import { matchFaqSnippet, matchReceptionistCapabilities } from "../src/faq.js";
import { advanceAppointmentFlow } from "../src/flows/appointmentFlow.js";
import { continueIntakeFlow, startIntakeFlow } from "../src/flows/intakeFlow.js";
import { matchesPolicyRedline } from "../src/policyRedlines.js";
import { resolvePostAt } from "../src/reminderParse.js";
import { scheduleSlackReminder } from "../src/scheduler.js";
import {
  stubCareNavigation,
  stubCheckInsuranceEligibility,
  stubCreateScheduleHold,
  stubPatientCommDraft,
} from "../src/tools.js";
import { getSlotSuggestions } from "../src/availability.js";
import { llmAsJudge } from "./support/llmJudge.js";

/**
 * Massive LLM-as-a-judge suite for receptionist capabilities.
 * Enable with `RUN_LLM_TESTS=1` or `npm run test:llm`.
 */

const runLlm = process.env.RUN_LLM_TESTS === "1";

type Scenario = {
  name: string;
  feature: string;
  userMessage: string;
  criterion: string;
  run: () => unknown | Promise<unknown>;
};

const scenarios: Scenario[] = [
  {
    feature: "schedule_alternatives",
    name: "slots_with_when_hint_include_hold_primary_alternates",
    userMessage: "Find slots Tuesday morning and hold one for me.",
    criterion:
      "Output should include a schedule hold id starting with GH-HOLD-, a primary slot based on the hint, and at least one alternate slot from clinic config.",
    run: () => {
      const suggestions = getSlotSuggestions({ whenHint: "Tuesday 9:00 AM ET" });
      const hold = stubCreateScheduleHold({ when: suggestions.primary, what: "CCM follow-up" });
      return { hold, suggestions };
    },
  },
  {
    feature: "schedule_alternatives",
    name: "slots_without_hint_use_clinic_primary_plus_alternates",
    userMessage: "What are my next available slots?",
    criterion:
      "Pass if: hold.hold_id starts with GH-HOLD-, suggestions.primary is a non-empty string, and suggestions.alternates has at least one item.",
    run: () => {
      const suggestions = getSlotSuggestions({});
      const hold = stubCreateScheduleHold({ when: suggestions.primary });
      return { hold, suggestions };
    },
  },
  {
    feature: "schedule_alternatives",
    name: "slots_skip_booked_primary_and_promote_alternate",
    userMessage: "Give me alternatives if the first slot is already taken.",
    criterion:
      "Pass if: suggestions.primary is different from basePrimary, hold.hold_id starts with GH-HOLD-, and suggestions.alternates length is >= 1.",
    run: () => {
      const base = getSlotSuggestions({});
      const suggestions = getSlotSuggestions({
        bookedSlots: new Set([base.primary.toLowerCase()]),
      });
      const hold = stubCreateScheduleHold({ when: suggestions.primary });
      return { hold, basePrimary: base.primary, suggestions };
    },
  },
  {
    feature: "insurance_eligibility_check",
    name: "insurance_with_payer_and_member_returns_mock_payer_line",
    userMessage: "Verify eligibility for GH-1001 with Aetna member 7788.",
    criterion:
      "Pass if eligibility_id starts with GH-ELIG-, status equals ACTIVE_DEMO, payer includes Aetna, and detail says mock/not real.",
    run: () =>
      stubCheckInsuranceEligibility({
        patient_id: "GH-1001",
        payer: "Aetna",
        member_id: "7788",
      }),
  },
  {
    feature: "insurance_eligibility_check",
    name: "insurance_defaults_payer_when_missing",
    userMessage: "Check coverage for GH-2002.",
    criterion:
      "When payer is missing, output should still provide eligibility id and a payer fallback value indicating this is a stub/mock.",
    run: () => stubCheckInsuranceEligibility({ patient_id: "GH-2002" }),
  },
  {
    feature: "insurance_eligibility_check",
    name: "insurance_includes_patient_and_member_in_detail",
    userMessage: "Check BlueCross eligibility for GH-8888 member M-123.",
    criterion:
      "Pass if detail includes GH-8888 and M-123 and indicates this is mock/demo/not real output.",
    run: () =>
      stubCheckInsuranceEligibility({
        patient_id: "GH-8888",
        payer: "BlueCross",
        member_id: "M-123",
      }),
  },
  {
    feature: "appointment_change",
    name: "cancel_path_completes_with_id_when_ref_present",
    userMessage: "Cancel appointment GH-9911.",
    criterion:
      "Cancel flow should complete without extra questions and include cancellation confirmation with appointment id and released slot wording.",
    run: () => {
      const b = bookAppointment({ slotLabel: "Thu 10am Demo", patientRef: "GH-9911", userId: "U1" });
      return advanceAppointmentFlow(undefined, "Cancel appointment GH-9911", {});
    },
  },
  {
    feature: "appointment_change",
    name: "reschedule_multi_turn_asks_then_completes",
    userMessage: "Reschedule GH-2001 to next Wednesday at 2pm.",
    criterion:
      "Pass if first.message contains 'time or window' and second.message contains both 'Appointment rescheduled' and 'Change ref'.",
    run: () => {
      bookAppointment({ slotLabel: "Mon 9am Demo", patientRef: "GH-2001", userId: "U1" });
      const first = advanceAppointmentFlow(undefined, "Reschedule GH-2001", {});
      const second = advanceAppointmentFlow(first.flow ?? undefined, "next Wednesday 2pm", {});
      return { first, second };
    },
  },
  {
    feature: "appointment_change",
    name: "waitlist_multi_turn_returns_waitlist_id",
    userMessage: "Waitlist GH-APT-AAAAAA for mornings.",
    criterion:
      "Waitlist flow should ask for timing if needed and then return a stub waitlist request id with the appointment reference.",
    run: () => {
      const first = advanceAppointmentFlow(undefined, "waitlist GH-APT-AAAAAA", {});
      const second = advanceAppointmentFlow(first.flow ?? undefined, "weekday mornings", {});
      return { first, second };
    },
  },
  {
    feature: "patient_comm_draft",
    name: "sms_draft_is_copy_only_not_sent",
    userMessage: "Draft an SMS reminder for tomorrow at 9am.",
    criterion:
      "Pass if hasDraftPrefix is true, isSms is true, and hasDemoNotSent is true.",
    run: () => {
      const draft = stubPatientCommDraft({
        channel: "sms",
        purpose: "Reminder for tomorrow visit",
        who: "Ms. Green",
        when: "tomorrow 9am",
      });
      const body = draft.body.toLowerCase();
      return {
        draft,
        hasDraftPrefix: draft.draft_id.startsWith("GH-DRAFT-"),
        isSms: draft.channel === "sms",
        hasDemoNotSent: body.includes("demo") && body.includes("not sent"),
      };
    },
  },
  {
    feature: "patient_comm_draft",
    name: "email_draft_contains_subject_and_draft_only_language",
    userMessage: "Draft an email with parking directions.",
    criterion:
      "Email draft should include a subject/body format and indicate this is draft-only communication, not sent.",
    run: () =>
      stubPatientCommDraft({
        channel: "email",
        purpose: "Parking directions for clinic visit",
        who: "Mr. Lane",
      }),
  },
  {
    feature: "patient_comm_draft",
    name: "sms_draft_supports_generic_purpose",
    userMessage: "Draft an SMS about updated appointment time.",
    criterion:
      "Pass if hasDraftPrefix is true, isSms is true, and hasDraftOnlyLanguage is true.",
    run: () => {
      const draft = stubPatientCommDraft({
        channel: "sms",
        purpose: "Your appointment time has been updated",
      });
      const body = draft.body.toLowerCase();
      return {
        draft,
        hasDraftPrefix: draft.draft_id.startsWith("GH-DRAFT-"),
        isSms: draft.channel === "sms",
        hasDraftOnlyLanguage:
          body.includes("demo") || body.includes("draft") || body.includes("not sent"),
      };
    },
  },
  {
    feature: "care_navigation",
    name: "care_nav_billing_keywords_route_to_billing",
    userMessage: "Who should own this reimbursement question?",
    criterion:
      "Routing output should return a route id and assign billing team when reimbursement/billing keywords are present.",
    run: () => stubCareNavigation({ text: "Need help with reimbursement and claim coding." }),
  },
  {
    feature: "care_navigation",
    name: "care_nav_device_keywords_route_to_logistics",
    userMessage: "Who handles cuff shipping issues?",
    criterion:
      "Routing output should return logistics team when device/shipment/cuff keywords are present.",
    run: () => stubCareNavigation({ text: "BP cuff shipment was delayed; who owns this?" }),
  },
  {
    feature: "care_navigation",
    name: "care_nav_rpm_keywords_route_to_rpm_nurse",
    userMessage: "Who should review RPM vitals trend?",
    criterion:
      "Routing output should return rpm_nurse team when RPM readings/vitals context appears.",
    run: () => stubCareNavigation({ text: "Patient RPM readings are elevated this week." }),
  },
  {
    feature: "pre_visit_intake",
    name: "intake_start_prompts_meds_question",
    userMessage: "Start pre-visit intake.",
    criterion:
      "Start of intake should ask the medications question and initialize flow state for the next step.",
    run: () => startIntakeFlow(),
  },
  {
    feature: "pre_visit_intake",
    name: "intake_second_step_prompts_allergies",
    userMessage: "Meds: lisinopril.",
    criterion:
      "Pass if asksAllergies is true and carriedMeds is true.",
    run: () => {
      const started = startIntakeFlow();
      const step = continueIntakeFlow(started.flow!, "lisinopril 10mg daily");
      return {
        asksAllergies: /allerg/i.test(step.message),
        carriedMeds: step.flow?.meds === "lisinopril 10mg daily",
      };
    },
  },
  {
    feature: "pre_visit_intake",
    name: "intake_completion_returns_bundle_and_ehr_stub_ref",
    userMessage: "Pharmacy: Walgreens on Main St.",
    criterion:
      "Final intake response should include bundle id, meds/allergies/pharmacy recap, and an EHR stub reference.",
    run: () => {
      const a = startIntakeFlow();
      const b = continueIntakeFlow(a.flow!, "metformin");
      const c = continueIntakeFlow(b.flow!, "penicillin");
      return continueIntakeFlow(c.flow!, "Walgreens Main St");
    },
  },
  {
    feature: "slack_reminder",
    name: "parse_relative_time_in_2_minutes",
    userMessage: "Remind me in 2 minutes.",
    criterion:
      "Reminder parse output should include a valid future postAt unix timestamp and label indicating relative time.",
    run: () => resolvePostAt({ when: "in 2 minutes", now: new Date("2026-04-01T12:00:00Z") }),
  },
  {
    feature: "slack_reminder",
    name: "schedule_message_calls_slack_api_and_returns_ids",
    userMessage: "Set a reminder for this thread in 2 minutes.",
    criterion:
      "Scheduling output should include a generated job id and Slack scheduled message id, confirming chat.scheduleMessage path.",
    run: async () => {
      const calls: unknown[] = [];
      const mockClient = {
        chat: {
          scheduleMessage: async (args: unknown) => {
            calls.push(args);
            return { ok: true, scheduled_message_id: "SM12345" };
          },
        },
      };
      const result = await scheduleSlackReminder(mockClient as any, {
        channelId: "C1",
        threadTs: "111.222",
        postAt: Math.floor(Date.now() / 1000) + 120,
        text: ":alarm_clock: follow up",
        userId: "U1",
      });
      return { result, calls };
    },
  },
  {
    feature: "slack_reminder",
    name: "parse_invalid_reminder_returns_null",
    userMessage: "Remind me sometime soon-ish.",
    criterion:
      "When no concrete reminder time is provided, parser should return null (not an invalid timestamp).",
    run: () => resolvePostAt({ when: "soon-ish maybe later" }),
  },
  {
    feature: "faq",
    name: "faq_snippet_matches_ccm_billing_question",
    userMessage: "How do I bill CPT 99457 for CCM?",
    criterion:
      "FAQ snippet output should return grounded CCM billing guidance text rather than task/action output.",
    run: () => matchFaqSnippet("How do I bill CPT 99457 for CCM?"),
  },
  {
    feature: "faq",
    name: "faq_snippet_matches_rpm_documentation_question",
    userMessage: "How should I document RPM 20 minute review time?",
    criterion:
      "FAQ snippet output should return RPM documentation guidance text with snippet-style content.",
    run: () => matchFaqSnippet("How should I document RPM 20 minute review time?"),
  },
  {
    feature: "faq",
    name: "faq_fallback_path_no_snippet_and_capabilities_available",
    userMessage: "What can you do as a receptionist?",
    criterion:
      "For capabilities/meta prompt, output should include receptionist capabilities overview; this is FAQ-style informational output, not booking/action output.",
    run: () => ({
      snippet: matchFaqSnippet("What can you do as a receptionist?"),
      capabilities: matchReceptionistCapabilities("What can you do as a receptionist?"),
    }),
  },
  {
    feature: "policy_redline",
    name: "policy_redline_matches_suicidal_phrase",
    userMessage: "I want to die.",
    criterion:
      "Pass if hit is true and reason is a non-empty string.",
    run: () => matchesPolicyRedline("I want to die"),
  },
  {
    feature: "policy_redline",
    name: "policy_redline_matches_self_harm_phrase",
    userMessage: "I'm thinking about self-harm.",
    criterion:
      "Policy check should flag self-harm language as redline hit for escalation.",
    run: () => matchesPolicyRedline("I'm thinking about self-harm."),
  },
  {
    feature: "policy_redline",
    name: "policy_redline_non_matching_phrase_not_flagged",
    userMessage: "I need to move my appointment to Friday.",
    criterion:
      "Routine scheduling language should not trigger policy redline hit.",
    run: () => matchesPolicyRedline("I need to move my appointment to Friday."),
  },
  {
    feature: "low_confidence_or_human_handoff",
    name: "low_confidence_unknown_uses_confirm_intent_handoff_text",
    userMessage: "Maybe, not sure, whatever works.",
    criterion:
      "Pass if output text includes 'Confirm intent with the coordinator'.",
    run: () =>
      formatHandoffPackage({
        summaryLines: ["Low confidence or unknown intent."],
        classification: {
          intent: "unknown",
          confidence: 0.31,
          entities: {},
          needs_clarification: false,
          rationale: "Ambiguous request",
        },
        latestUserText: "Maybe, not sure, whatever works.",
        channelId: "C1",
        threadTs: "1234.5678",
      }),
  },
  {
    feature: "low_confidence_or_human_handoff",
    name: "explicit_human_escalation_uses_playbook_text",
    userMessage: "I need a real person now.",
    criterion:
      "Handoff package for human_escalation should include escalation playbook style suggested action.",
    run: () =>
      formatHandoffPackage({
        summaryLines: ["User requested a human."],
        classification: {
          intent: "human_escalation",
          confidence: 0.99,
          entities: { what: "human agent" },
          needs_clarification: false,
        },
        latestUserText: "I need a real person now.",
        channelId: "C1",
        threadTs: "1234.5678",
      }),
  },
  {
    feature: "low_confidence_or_human_handoff",
    name: "high_confidence_non_human_handoff_uses_takeover_text",
    userMessage: "Please handle this manually.",
    criterion:
      "Pass if output text includes 'Take over the thread and complete the coordinator request manually'.",
    run: () =>
      formatHandoffPackage({
        summaryLines: ["Manual takeover requested."],
        classification: {
          intent: "task_routing",
          confidence: 0.9,
          entities: { what: "manual queue routing" },
          needs_clarification: false,
        },
        latestUserText: "Please handle this manually.",
        channelId: "C1",
        threadTs: "1234.5678",
      }),
  },
];

describe.skipIf(!runLlm)("Receptionist capability LLM-as-judge suite", () => {
  const report: { feature: string; name: string; ok: boolean; judgeReason: string; score: number }[] =
    [];
  let dbDir = "";
  const priorDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    closeDb();
    dbDir = mkdtempSync(path.join(tmpdir(), "gh-llm-judge-"));
    process.env.DATA_DIR = dbDir;
  });

  afterEach(() => {
    closeDb();
    if (dbDir) rmSync(dbDir, { recursive: true, force: true });
    dbDir = "";
  });

  afterAll(() => {
    closeDb();
    process.env.DATA_DIR = priorDataDir;
    console.log("\n──────── LLM test summary ────────");
    for (const row of report) {
      const mark = row.ok ? "PASS" : "FAIL";
      console.log(
        `[${mark}] ${row.feature}/${row.name} | score=${row.score.toFixed(2)} | ${row.judgeReason}`,
      );
    }
    console.log("──────────────────────────────────\n");
  });

  for (const sc of scenarios) {
    it(`${sc.feature}: ${sc.name}`, async () => {
      const actual = await sc.run();

      const judge = await llmAsJudge({
        criterion: sc.criterion,
        userMessage: sc.userMessage,
        actual,
      });

      report.push({
        feature: sc.feature,
        name: sc.name,
        ok: judge.pass,
        judgeReason: judge.reasoning,
        score: judge.score,
      });

      expect(
        judge.pass,
        `Judge rejected: ${judge.reasoning}\nActual: ${JSON.stringify(actual, null, 2)}`,
      ).toBe(true);
      expect(judge.score).toBeGreaterThanOrEqual(0.5);
    });
  }
});
