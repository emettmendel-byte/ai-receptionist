import { describe, expect, it } from "vitest";
import {
  isAvailabilityOnlyQuestion,
  isExplicitBookingRequest,
  patchSchedulingClassification,
} from "../src/scheduleRouting.js";

describe("scheduleRouting", () => {
  it("book me + day is explicit booking (not availability)", () => {
    expect(isExplicitBookingRequest("book me for thursday at 9am")).toBe(true);
    expect(isAvailabilityOnlyQuestion("book me for thursday at 9am")).toBe(false);
  });

  it("when can I book stays availability, not explicit booking", () => {
    expect(isAvailabilityOnlyQuestion("when can I book an appointment?")).toBe(true);
    expect(isExplicitBookingRequest("when can I book an appointment?")).toBe(false);
  });

  it("patch forces schedule_inquiry for explicit book even if NLU said availability", () => {
    const c = patchSchedulingClassification("Book me for Thursday at 9am", {
      intent: "availability_inquiry",
      confidence: 0.9,
      entities: {},
      needs_clarification: false,
    });
    expect(c.intent).toBe("schedule_inquiry");
  });
});
