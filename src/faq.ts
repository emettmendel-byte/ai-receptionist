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
