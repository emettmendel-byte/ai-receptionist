import { afterAll, describe, expect, it } from "vitest";
import { classifyTurn } from "../src/llm/classify.js";
import type { ChatTurn } from "../src/types.js";
import { llmAsJudge } from "./support/llmJudge.js";

/**
 * ## What this suite tests (enable with `RUN_LLM_TESTS=1` or `npm run test:llm`)
 *
 * **Pipeline**
 * 1. **Input:** prior conversation turns (optional) + latest user message string.
 * 2. **Classifier output:** `classifyTurn` calls Ollama and returns JSON-shaped `{ intent, confidence, entities, … }`.
 * 3. **Judge input:** that object + a written rubric (`criterion`).
 * 4. **Judge output:** Ollama returns `{ pass, score, reasoning }`; we require `pass` and `score >= 0.5`.
 *
 * So each case checks both **NLU quality** and **LLM-as-judge agreement** with the scenario blurb.
 *
 * Requires a running Ollama with `OLLAMA_MODEL` (and optionally `JUDGE_MODEL`) pulled.
 */

const runLlm = process.env.RUN_LLM_TESTS === "1";

type Scenario = {
  name: string;
  /**
   * Plain language: what we send in and what “good” looks like before the judge runs.
   */
  blurb: string;
  /** Rubric passed to the judge model. */
  criterion: string;
  userMessage: string;
  priorTurns?: ChatTurn[];
};

const scenarios: Scenario[] = [
  {
    name: "reminder_trigger",
    blurb:
      "Input: a single user message asking for a Slack reminder in 2 minutes about calling a patient. " +
      "Expected NLU: intent `reminder_trigger`, confidence not trivially low, and entities that capture " +
      "a time expression (e.g. `when` or `when_iso`). The judge must agree this matches the rubric.",
    criterion:
      "The user wants a Slack reminder with a relative time. " +
      "The classified intent should be reminder_trigger. " +
      "Entities should mention a time (when or when_iso) appropriate to the message. " +
      "Confidence should be at least 0.5 if the request is clear.",
    userMessage: "Send me a Slack reminder in 2 minutes to call the patient about their meds.",
  },
  {
    name: "schedule_inquiry",
    blurb:
      "Input: user asks what appointment/slot availability exists for an RPM check-in this week. " +
      "Expected NLU: intent `schedule_inquiry` with solid confidence. Judge confirms it reads as scheduling, not FAQ or task routing.",
    criterion:
      "The user is asking about scheduling or availability for a visit. " +
      "Intent should be schedule_inquiry with confidence at least 0.5.",
    userMessage: "What slots do we have for an RPM check-in this week?",
  },
  {
    name: "faq",
    blurb:
      "Input: user asks how to bill a specific CPT code for CCM (informational). " +
      "Expected NLU: intent `faq` — policy/how-to, not a request to schedule or create a Slack reminder. Judge enforces that distinction.",
    criterion:
      "The user is asking a policy or how-to question (FAQ), not requesting an action in Slack. " +
      "Intent should be faq with confidence at least 0.5.",
    userMessage: "How do I bill CPT 99457 for CCM?",
  },
  {
    name: "task_routing",
    blurb:
      "Input: user wants something sent to the billing queue about reimbursement. " +
      "Expected NLU: intent `task_routing` (internal routing), not `faq` or `schedule_inquiry`.",
    criterion:
      "The user wants work routed to an internal team or queue. " +
      "Intent should be task_routing with confidence at least 0.5.",
    userMessage: "Route this to the billing queue — question about RPM reimbursement.",
  },
  {
    name: "human_escalation",
    blurb:
      "Input: user explicitly asks for a real person and says they are uncomfortable with the bot. " +
      "Expected NLU: intent `human_escalation` with high confidence so the live app would hand off.",
    criterion:
      "The user explicitly wants a human or supervisor, or expresses discomfort with the bot. " +
      "Intent should be human_escalation with confidence at least 0.5.",
    userMessage: "I need a real person — I'm not comfortable with the bot.",
  },
  {
    name: "multi_turn_context",
    blurb:
      "Input: prior user+assistant turns establish CCM scheduling for Mrs. Chen; latest message is only " +
      "'What about next Tuesday morning?' Expected NLU: still `schedule_inquiry` (uses session transcript), " +
      "not a generic FAQ — judge checks that follow-up is interpreted as scheduling continuation.",
    criterion:
      "Given the prior turn about Mrs. Chen and CCM, the follow-up about Tuesday should still be interpreted as scheduling (schedule_inquiry), not faq. " +
      "Confidence at least 0.45.",
    userMessage: "What about next Tuesday morning?",
    priorTurns: [
      {
        role: "user",
        text: "We're scheduling a CCM follow-up for Mrs. Chen.",
        at: "2026-04-01T12:00:00.000Z",
      },
      {
        role: "assistant",
        text: "I can help with scheduling.",
        at: "2026-04-01T12:00:01.000Z",
      },
    ],
  },
  {
    name: "insurance_eligibility_check",
    blurb:
      "Input: coordinator asks to verify insurance / eligibility for a patient before a visit. " +
      "Expected NLU: intent `insurance_eligibility_check`.",
    criterion:
      "The user wants insurance or eligibility verification. " +
      "Intent should be insurance_eligibility_check with confidence at least 0.5.",
    userMessage: "Can you verify insurance for patient GH-8821 before Tuesday's visit?",
  },
  {
    name: "appointment_change",
    blurb:
      "Input: user wants to cancel a visit due to admission. " +
      "Expected NLU: intent `appointment_change` (not schedule_inquiry).",
    criterion:
      "The user wants to cancel, reschedule, or waitlist an appointment. " +
      "Intent should be appointment_change with confidence at least 0.5.",
    userMessage: "Cancel Mrs. Lee's CCM visit on Friday — patient was admitted.",
  },
  {
    name: "pre_visit_intake",
    blurb:
      "Input: user wants to run pre-visit intake / checklist before an appointment. " +
      "Expected NLU: intent `pre_visit_intake`.",
    criterion:
      "The user wants pre-visit intake or a checklist (meds, allergies, pharmacy). " +
      "Intent should be pre_visit_intake with confidence at least 0.5.",
    userMessage: "Start pre-visit intake for tomorrow's CCM appointment.",
  },
];

describe.skipIf(!runLlm)("NLU + LLM-as-judge (Ollama)", () => {
  const report: { name: string; ok: boolean; judgeReason: string; intent: string; conf: number }[] =
    [];

  afterAll(() => {
    console.log("\n──────── LLM test summary ────────");
    for (const row of report) {
      const mark = row.ok ? "PASS" : "FAIL";
      console.log(
        `[${mark}] ${row.name} | intent=${row.intent} conf=${row.conf.toFixed(2)} | ${row.judgeReason}`,
      );
    }
    console.log("──────────────────────────────────\n");
  });

  for (const sc of scenarios) {
    it(sc.name, async () => {
      console.info(`\n── ${sc.name} ──\n${sc.blurb}\n`);

      const turns = sc.priorTurns ?? [];
      const classification = await classifyTurn(turns, sc.userMessage);

      const judge = await llmAsJudge({
        criterion: sc.criterion,
        userMessage: sc.userMessage,
        actual: classification,
      });

      report.push({
        name: sc.name,
        ok: judge.pass,
        judgeReason: judge.reasoning,
        intent: classification.intent,
        conf: classification.confidence,
      });

      expect(
        judge.pass,
        `Judge rejected: ${judge.reasoning}\nActual: ${JSON.stringify(classification, null, 2)}`,
      ).toBe(true);
      expect(judge.score).toBeGreaterThanOrEqual(0.5);
    });
  }
});
