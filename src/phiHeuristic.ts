import { phiPatterns } from "./policyRedlines.js";

/** Demo heuristic: possible PHI-like content in message (audit only). */
export function phiHeuristicFlag(text: string): boolean {
  for (const re of phiPatterns()) {
    if (re.test(text)) return true;
  }
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) return true;
  if (/\bMRN[:\s#]*[A-Z0-9-]+\b/i.test(text)) return true;
  return false;
}
