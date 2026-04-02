/**
 * Intent categories for Greens Health receptionist (CCM/RPM + Sully-style surface stubs).
 */
export const INTENT_IDS = [
  "schedule_inquiry",
  "reminder_trigger",
  "faq",
  "task_routing",
  "human_escalation",
  "insurance_eligibility_check",
  "appointment_change",
  "patient_comm_draft",
  "care_navigation",
  "pre_visit_intake",
] as const;

export type IntentId = (typeof INTENT_IDS)[number];

/** Golden + paraphrase examples for demos and regression. */
export const GOLDEN_PHRASES: Record<IntentId, string[]> = {
  schedule_inquiry: [
    "Can we book a follow-up CCM visit for Mrs. Chen sometime next Tuesday morning?",
    "What slots do we have for an RPM check-in this week?",
    "Patient needs a telehealth slot — earliest available?",
  ],
  reminder_trigger: [
    "Send me a Slack reminder in 2 minutes to call the patient about their meds.",
    "Ping this thread in 90 seconds with 'follow up labs'.",
    "Schedule a reminder here tomorrow at 9am to review care plan.",
  ],
  faq: [
    "What's our policy on documenting RPM time over 20 minutes?",
    "How do I bill CPT 99457 for CCM?",
    "Where do coordinators log escalations in Greens?",
  ],
  task_routing: [
    "Route this to the billing queue — question about RPM reimbursement.",
    "Create an internal task for supplies to ship a BP cuff to patient ID GH-4412.",
    "Please assign a follow-up to the lead nurse about the prior auth.",
  ],
  human_escalation: [
    "I need a real person — this is urgent and I'm not comfortable with the bot.",
    "Escalate to a supervisor; the member is threatening to leave the program.",
    "Something seems wrong with this PHI context — get a human.",
  ],
  insurance_eligibility_check: [
    "Can you verify insurance for patient GH-8821 before Tuesday's visit?",
    "Run an eligibility check for Aetna member ID ending 4455.",
    "Is this patient's Medicare Advantage plan active for RPM billing?",
  ],
  appointment_change: [
    "Cancel Mrs. Lee's CCM visit on Friday — patient was admitted.",
    "Reschedule the RPM check-in to next Wednesday afternoon.",
    "Add this patient to the waitlist for an earlier telehealth slot.",
  ],
  patient_comm_draft: [
    "Draft a short SMS to remind the patient to fast before labs tomorrow.",
    "Write an email confirmation for the Thursday telehealth visit with join link placeholder.",
    "Give me text to send the patient directions to the clinic.",
  ],
  care_navigation: [
    "Should this question go to the RPM nurse or billing?",
    "Triage: patient angry about device shipment — who owns that?",
    "Route me to the right team for prior auth on a CGM.",
  ],
  pre_visit_intake: [
    "Start pre-visit intake for tomorrow's CCM appointment.",
    "Collect intake answers: meds, allergies, preferred pharmacy.",
    "Run the intake checklist for patient GH-2001 before the visit.",
  ],
};

export const DEMO_NARRATIVE = [
  "Coordinator opens thread in #care-coordination.",
  "Ask a schedule-style question → stub hold + primary/alternate slots from clinic config.",
  "Ask for insurance eligibility stub → mock payer response.",
  "Reschedule/cancel/waitlist → multi-turn appointment flow or stub.",
  "Draft patient SMS/email copy (not sent).",
  "Care navigation → stub routing table (CCM/RPM/nurse/billing).",
  "Pre-visit intake → multi-turn checklist, then EHR stub.",
  "Reminder in Slack → scheduleMessage.",
  "FAQ → snippet or Ollama.",
  "Policy redline phrase → forced handoff.",
  "Low-confidence or explicit human escalation → handoff block.",
] as const;

export const NON_GOALS = [
  "No live EHR, calendar, payer APIs, or SMS gateways.",
  "No PHI-grade compliance review; API keys via env only.",
  "Not production multi-tenant hardening.",
] as const;
