import type { IntakeFlowState } from "../types.js";
import { stubSubmitIntakeBundle, stubSyncNoteToEhr } from "../tools.js";

export type IntakeFlowResult = {
  message: string;
  flow: IntakeFlowState | null;
};

const Q_MEDS = "*(Intake 1/3)* List current *medications* (or say *none*).";
const Q_ALLERGIES = "*(Intake 2/3)* Any *allergies* we should flag?";
const Q_PHARMACY = "*(Intake 3/3)* *Preferred pharmacy* name or address?";

/** First turn after `pre_visit_intake` intent: show question 1 and wait for meds. */
export function startIntakeFlow(): IntakeFlowResult {
  return {
    message: Q_MEDS,
    flow: { next_field: "meds" },
  };
}

/** Subsequent turns: record answer, ask next question or submit stubs. */
export function continueIntakeFlow(flow: IntakeFlowState, userText: string): IntakeFlowResult {
  const t = userText.trim() || "—";

  if (flow.next_field === "meds") {
    return {
      message: Q_ALLERGIES,
      flow: { next_field: "allergies", meds: t },
    };
  }

  if (flow.next_field === "allergies") {
    return {
      message: Q_PHARMACY,
      flow: { next_field: "pharmacy", meds: flow.meds, allergies: t },
    };
  }

  const pharmacy = t;
  const bundle = stubSubmitIntakeBundle({
    meds: flow.meds ?? "",
    allergies: flow.allergies ?? "",
    pharmacy,
  });
  const sync = stubSyncNoteToEhr({
    summary: `Pre-visit intake bundle ${bundle.bundle_id}`,
  });
  return {
    message:
      `*Pre-visit intake complete (stubs)*\n` +
      `• Bundle ID: \`${bundle.bundle_id}\`\n` +
      `• Meds: _${(flow.meds ?? "").slice(0, 120)}${(flow.meds ?? "").length > 120 ? "…" : ""}_\n` +
      `• Allergies: _${flow.allergies ?? "—"}_\n` +
      `• Pharmacy: _${pharmacy}_\n` +
      `_${bundle.note}_\n` +
      `• EHR stub ref: \`${sync.ref}\` — _${sync.note}_`,
    flow: null,
  };
}
