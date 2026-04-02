import fs from "node:fs";
import path from "node:path";

type PolicyFile = {
  patterns?: string[];
  phi_audit_patterns?: string[];
};

let cached: PolicyFile | null = null;

function loadPolicy(): PolicyFile {
  if (cached) return cached;
  const p =
    process.env.POLICY_REDLINES_PATH ??
    path.join(process.cwd(), "config", "policy-redlines.json");
  try {
    cached = JSON.parse(fs.readFileSync(p, "utf8")) as PolicyFile;
  } catch {
    cached = { patterns: [], phi_audit_patterns: [] };
  }
  return cached;
}

/** Force human escalation (crisis / policy demo lines). */
export function matchesPolicyRedline(text: string): { hit: boolean; reason?: string } {
  const { patterns = [] } = loadPolicy();
  const t = text.toLowerCase();
  for (const raw of patterns) {
    try {
      const re = new RegExp(raw, "i");
      if (re.test(text)) {
        return { hit: true, reason: `Policy redline matched (${raw.slice(0, 48)}…)` };
      }
    } catch {
      if (t.includes(raw.toLowerCase())) {
        return { hit: true, reason: `Policy redline matched (substring)` };
      }
    }
  }
  return { hit: false };
}

/** Patterns for audit PHI heuristic only (do not auto-escalate on these in demo). */
export function phiPatterns(): RegExp[] {
  const { phi_audit_patterns = [] } = loadPolicy();
  const out: RegExp[] = [];
  for (const raw of phi_audit_patterns) {
    try {
      out.push(new RegExp(raw));
    } catch {
      /* skip */
    }
  }
  return out;
}
