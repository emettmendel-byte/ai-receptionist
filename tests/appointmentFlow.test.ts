import { describe, expect, it } from "vitest";
import { advanceAppointmentFlow } from "../src/flows/appointmentFlow.js";

describe("advanceAppointmentFlow", () => {
  it("completes cancel in one turn when action and ref present", () => {
    const r = advanceAppointmentFlow(undefined, "Cancel appointment GH-9911 for Mrs. Lee", {});
    expect(r.flow).toBeNull();
    expect(r.message).toContain("GH-APPT-");
    expect(r.message).toContain("cancel");
  });

  it("asks for time on reschedule then completes on follow-up", () => {
    const a = advanceAppointmentFlow(undefined, "Reschedule GH-2001", {});
    expect(a.flow).not.toBeNull();
    expect(a.message).toMatch(/time|window/i);

    const b = advanceAppointmentFlow(a.flow!, "next Wednesday 2pm", {});
    expect(b.flow).toBeNull();
    expect(b.message).toContain("reschedule");
  });
});
