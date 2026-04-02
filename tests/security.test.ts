import { describe, expect, it } from "vitest";
import { assertAuthorized, redactText, redactUnknown } from "../src/security.js";

describe("security helpers", () => {
  it("redactText masks ssn and emails", () => {
    const t = "SSN 123-45-6789 email jane@example.com";
    const out = redactText(t);
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("123-45-6789");
    expect(out).not.toContain("jane@example.com");
  });

  it("redactUnknown masks sensitive object fields", () => {
    const out = redactUnknown({
      patient_id: "GH-1234",
      member_id: "M-999",
      nested: { note: "ok" },
    }) as Record<string, unknown>;
    expect(out.patient_id).toBe("[REDACTED]");
    expect(out.member_id).toBe("[REDACTED]");
  });

  it("assertAuthorized throws when scope missing", () => {
    expect(() => assertAuthorized(["availability:read"], "booking:write")).toThrow();
    expect(() => assertAuthorized(["admin"], "booking:write")).not.toThrow();
  });
});
