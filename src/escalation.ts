import type { Classification } from "./types.js";

export type HandoffInput = {
  summaryLines: string[];
  classification: Classification;
  latestUserText: string;
  channelId: string;
  threadTs: string;
  workspaceDomain?: string;
};

function threadPermalink(
  channelId: string,
  threadTs: string,
  domain?: string,
): string {
  if (domain) {
    const formatted = threadTs.replace(".", "");
    return `https://${domain}/archives/${channelId.replace(/^C/, "")}/p${formatted}`;
  }
  return `channel:${channelId} thread_ts:${threadTs}`;
}

export function formatHandoffPackage(input: HandoffInput): string {
  const c = input.classification;
  const entities = [
    c.entities.who && `Who: ${c.entities.who}`,
    c.entities.what && `What: ${c.entities.what}`,
    c.entities.when && `When: ${c.entities.when}`,
    c.entities.patient_id && `Patient: ${c.entities.patient_id}`,
    c.entities.program && `Program: ${c.entities.program}`,
  ]
    .filter(Boolean)
    .join("\n");

  const link = threadPermalink(input.channelId, input.threadTs, input.workspaceDomain);

  const suggested =
    c.intent === "unknown" || c.confidence < 0.65
      ? "Confirm intent with the coordinator; if clinical, use standard PHI protocols."
      : c.intent === "human_escalation"
        ? "Join the thread, acknowledge urgency, and continue per escalation playbook."
        : "Take over the thread and complete the coordinator request manually; bot paused this flow.";

  return [
    ":sos: *Human handoff — Greens receptionist prototype*",
    "",
    "*Summary*",
    ...input.summaryLines.map((l) => `• ${l}`),
    "",
    "*Latest user message*",
    `> ${input.latestUserText.replace(/\n/g, " ")}`,
    "",
    "*NLU*",
    `Intent: \`${c.intent}\` — confidence: *${c.confidence.toFixed(2)}*`,
    c.rationale && `Rationale: _${c.rationale}_`,
    "",
    "*Extracted entities*",
    entities || "_none structured_",
    "",
    "*Suggested next action*",
    suggested,
    "",
    `*Context*: ${link}`,
  ]
    .filter(Boolean)
    .join("\n");
}
