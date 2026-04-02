import { INTENT_IDS, type IntentId } from "../intents.js";
import type { Classification, ChatTurn } from "../types.js";
import { extractJsonObject, ollamaChat } from "./ollama.js";

function transcriptLines(turns: ChatTurn[]): string {
  return turns
    .slice(-8)
    .map((x) => `${x.role === "user" ? "User" : "Assistant"}: ${x.text}`)
    .join("\n");
}

const system = `You are the NLU layer for Greens Health's AI receptionist (CCM/RPM care coordination).
Classify the user's latest message into exactly one intent from:
- schedule_inquiry: scheduling, availability, booking, slots, visits
- reminder_trigger: reminders, pings, schedule a Slack reminder, follow-up nudge with timing
- faq: policies, billing codes, how-to, documentation questions
- task_routing: assign work, route to team/billing/nurse/supplies, internal tasks
- human_escalation: explicit request for human, supervisor, urgency/complaint, discomfort with bot
- insurance_eligibility_check: verify eligibility, benefits, payer, member ID, coverage before visit
- appointment_change: cancel, reschedule, move a visit, or waitlist / earlier slot
- patient_comm_draft: draft SMS or email text to a patient (not sending — copy only)
- care_navigation: triage — which internal team (RPM nurse, billing, logistics, CCM) should own this
- pre_visit_intake: start or continue pre-visit checklist (meds, allergies, pharmacy)
- unknown: does not fit

Also extract entities: who (patient/name/id if any), what (topic), when (time expression), when_iso (ISO-8601 time in reminder/schedule context when you can infer it), patient_id, program, raw_notes, payer, member_id, language (ISO code if user asks for non-English).

Return JSON only with keys:
intent (string), confidence (number 0-1), entities (object, optional fields),
needs_clarification (boolean), clarification_question (string or null), rationale (short string)

Rules:
- If the user mixes intents, pick the primary action they want now.
- confidence should reflect ambiguity; use <0.5 for mixed/unclear requests.
- For reminder_trigger, capture "when" precisely from user text.
- human_escalation if they explicitly want a person or express distress about using AI.
- appointment_change includes cancel, reschedule, and waitlist requests.`;

function normalizeIntent(raw: string): IntentId | "unknown" {
  const x = raw.trim() as IntentId;
  if (INTENT_IDS.includes(x)) return x;
  return "unknown";
}

export async function classifyTurn(
  turns: ChatTurn[],
  latestUserText: string,
): Promise<Classification> {
  const user = `${transcriptLines(turns)}\nUser: ${latestUserText}`;

  const raw = await ollamaChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    formatJson: true,
    temperature: 0.2,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonObject(raw || "{}")) as Record<string, unknown>;
  } catch {
    return {
      intent: "unknown",
      confidence: 0.2,
      entities: { raw_notes: latestUserText },
      needs_clarification: true,
      clarification_question:
        "I could not parse that reliably — what would you like me to do (schedule, insurance check, appointment change, intake, draft patient message, care navigation, remind, FAQ, route a task, or speak with someone)?",
    };
  }

  const conf = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
  const intent = normalizeIntent(String(parsed.intent ?? "unknown"));
  const entities = (parsed.entities ?? {}) as Classification["entities"];

  return {
    intent,
    confidence: conf,
    entities,
    needs_clarification: Boolean(parsed.needs_clarification),
    clarification_question:
      typeof parsed.clarification_question === "string"
        ? parsed.clarification_question
        : undefined,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
  };
}
