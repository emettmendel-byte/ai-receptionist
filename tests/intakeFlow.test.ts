import { describe, expect, it } from "vitest";
import { continueIntakeFlow, startIntakeFlow } from "../src/flows/intakeFlow.js";

describe("intakeFlow", () => {
  it("startIntakeFlow asks first question", () => {
    const s = startIntakeFlow();
    expect(s.flow?.next_field).toBe("meds");
    expect(s.message).toContain("medications");
  });

  it("continueIntakeFlow runs three steps then completes", () => {
    const s0 = startIntakeFlow();
    const s1 = continueIntakeFlow(s0.flow!, "lisinopril");
    expect(s1.flow?.next_field).toBe("allergies");
    const s2 = continueIntakeFlow(s1.flow!, "NKDA");
    expect(s2.flow?.next_field).toBe("pharmacy");
    const s3 = continueIntakeFlow(s2.flow!, "CVS Main St");
    expect(s3.flow).toBeNull();
    expect(s3.message).toContain("GH-INTAKE-");
  });
});
