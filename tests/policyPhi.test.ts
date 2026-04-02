import { describe, expect, it } from "vitest";
import { phiHeuristicFlag } from "../src/phiHeuristic.js";
import { matchesPolicyRedline } from "../src/policyRedlines.js";

describe("policy redlines + PHI heuristic (demo)", () => {
  it("matchesPolicyRedline detects crisis-style phrases", () => {
    expect(matchesPolicyRedline("I want to die").hit).toBe(true);
    expect(matchesPolicyRedline("Book a CCM visit Tuesday").hit).toBe(false);
  });

  it("phiHeuristicFlag is true for SSN-like patterns", () => {
    expect(phiHeuristicFlag("patient SSN 123-45-6789 please")).toBe(true);
    expect(phiHeuristicFlag("schedule follow-up next week")).toBe(false);
  });
});
