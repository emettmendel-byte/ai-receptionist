const CAPABILITIES_BODY = [
  "I'm a *Slack-first coordinator assistant* (prototype). Here's what I can help with:",
  "• *Availability* — ask *when you can book* for dated open times from a demo calendar (no booking).\n• *Booking* — say *book* / *schedule me* + a time; SQLite stores `GH-APT-…` and blocks that slot until cancel/reschedule.",
  "• *Reminders* — schedule a Slack message in this thread (e.g. “in 2 minutes”).",
  "• *Insurance* — mock eligibility stub (not a real payer check).",
  "• *Appointments* — cancel / reschedule / waitlist via a short multi-turn flow (stubs only).",
  "• *Patient comms* — draft SMS/email *copy* (nothing is sent).",
  "• *Care navigation* — suggest which internal queue might own a question (stub routing).",
  "• *Pre-visit intake* — three-step checklist, then stub bundle + EHR note ref.",
  "• *FAQ* — Greens/CCM/RPM snippets or a short LLM answer.",
  "• *Tasks* — log a stub internal task to a demo queue.",
  "• *Voice* — if you send audio and local Whisper is configured, I transcribe then run the same flows.",
  "• *Escalation* — low confidence, explicit human request, or policy redlines → handoff block.",
  "_Ask a concrete request (e.g. “slots next week”, “verify insurance for GH-1234”) rather than “what can you do” if you want an action._",
].join("\n");

/** Meta questions about the bot itself — not a request to book or list real calendar slots. */
export function matchReceptionistCapabilities(userText: string): string | null {
  const t = userText.trim();
  if (t.length < 8 || t.length > 400) return null;
  const lower = t.toLowerCase();

  const patterns: RegExp[] = [
    /\bwhat\s+can\s+you\s+do\b/i,
    /\bwhat\s+do\s+you\s+do\b/i,
    /\bwhat\s+are\s+you\s+(?:for|able\s+to|capable\s+of)\b/i,
    /\bhow\s+can\s+you\s+help\b/i,
    /\byour\s+capabilities\b/i,
    /\blist\s+(?:your\s+)?(?:features|capabilities)\b/i,
    /\bwhat\s+.*\b(?:receptionist|bot|assistant)\b.*\b(?:do|help|offer|handle)\b/i,
    /\b(?:receptionist|bot|assistant)\b.*\bwhat\s+can\s+you\b/i,
  ];

  if (!patterns.some((re) => re.test(t))) return null;

  // Avoid stealing real scheduling questions that happen to mention "receptionist"
  if (
    /\b(book|slot|availability|schedule\s+(?:a|an|the)?\s*(?:visit|appt|appointment))\b/i.test(lower) &&
    !/\bwhat\s+can\s+you\s+do\b/i.test(t)
  ) {
    return null;
  }

  return `*Receptionist capabilities (overview)*\n${CAPABILITIES_BODY}`;
}

/** Tiny in-repo snippets so FAQ responses are grounded for the demo. */
const SNIPPETS: { keywords: string[]; title: string; body: string }[] = [
  {
    keywords: ["rpm", "20 minute", "time", "document"],
    title: "RPM documentation",
    body:
      "For RPM, coordinators should document review time in the care management note. " +
      "If review exceeds 20 minutes in a month, split documentation across sessions where clinically accurate " +
      "and align with Greens policy; billing for 99454/99457 follows documented minutes and medical necessity.",
  },
  {
    keywords: ["99457", "ccm", "bill", "cpt"],
    title: "CCM billing (99457)",
    body:
      "CPT 99457 covers the first 20 minutes of clinical staff time directed by a physician or QHP for CCM. " +
      "Additional 99457 time may be billable in separate months per CMS rules; verify payer-specific policy.",
  },
  {
    keywords: ["escalat", "log", "greens", "where"],
    title: "Internal escalations",
    body:
      "Log operational escalations in the Greens care coordination tracker (demo: #care-ops-escalations) " +
      "with patient/program context and urgency. PHI stays in approved systems only.",
  },
];

export function matchFaqSnippet(userText: string): string | null {
  const t = userText.toLowerCase();
  for (const s of SNIPPETS) {
    if (s.keywords.some((k) => t.includes(k))) {
      return `**${s.title}**\n${s.body}`;
    }
  }
  return null;
}
