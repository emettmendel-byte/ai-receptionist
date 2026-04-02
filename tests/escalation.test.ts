import { describe, expect, it } from "vitest";
import { formatHandoffPackage } from "../src/escalation.js";
import type { Classification } from "../src/types.js";

/**
 * ## What this suite tests
 * `formatHandoffPackage` builds the **markdown handoff** posted when we escalate to a human.
 * It must surface summary bullets, the raw user line, NLU (intent + confidence), extracted
 * entities, a suggested next action, and a thread context link.
 *
 * ## Inputs
 * - `summaryLines`, `classification` (intent, confidence, entities, rationale)
 * - `latestUserText`, `channelId`, `threadTs`, optional `workspaceDomain`
 *
 * ## Expected output
 * One string containing labeled sections (`*Summary*`, `*NLU*`, etc.) suitable for Slack `mrkdwn`.
 */

describe("formatHandoffPackage (escalation / handoff)", () => {
  const baseClassification: Classification = {
    intent: "unknown",
    confidence: 0.4,
    entities: { who: "Mrs. Chen", what: "follow-up", when: "Tuesday" },
    needs_clarification: false,
    rationale: "Ambiguous request",
  };

  /*
   * Input: low-confidence `unknown` intent, entities who/what/when, summary line, user text
   * "maybe next week?", channel + thread ids, workspaceDomain for permalink.
   * Expected: handoff string includes all major headings, quoted user line, intent `unknown`,
   * confidence 0.40, entity lines (e.g. Who: Mrs. Chen), low-confidence suggested action,
   * and an https://…slack.com/archives/… context URL.
   */
  it("includes required sections and entity lines", () => {
    const text = formatHandoffPackage({
      summaryLines: ["Low confidence routing."],
      classification: baseClassification,
      latestUserText: "maybe next week?",
      channelId: "C01234567",
      threadTs: "1234.5678",
      workspaceDomain: "acme.slack.com",
    });

    expect(text).toContain("Human handoff");
    expect(text).toContain("*Summary*");
    expect(text).toContain("Low confidence routing.");
    expect(text).toContain("*Latest user message*");
    expect(text).toContain("maybe next week?");
    expect(text).toContain("*NLU*");
    expect(text).toContain("`unknown`");
    expect(text).toContain("0.40");
    expect(text).toContain("*Extracted entities*");
    expect(text).toContain("Who: Mrs. Chen");
    expect(text).toContain("*Suggested next action*");
    expect(text).toContain("*Context*");
    expect(text).toContain("https://acme.slack.com/archives/");
  });

  /*
   * Input: `human_escalation` with high confidence (user explicitly wanted a person).
   * Expected: suggested-action text mentions the escalation / playbook path (not the generic
   * low-confidence coordinator line).
   */
  it("uses human_escalation suggested action when intent matches", () => {
    const c: Classification = {
      ...baseClassification,
      intent: "human_escalation",
      confidence: 0.95,
    };
    const text = formatHandoffPackage({
      summaryLines: ["User asked for a human."],
      classification: c,
      latestUserText: "get me a person",
      channelId: "C01",
      threadTs: "1.2",
    });
    expect(text).toContain("escalation playbook");
  });
});
