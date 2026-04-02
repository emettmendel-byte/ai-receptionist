import { describe, expect, it } from "vitest";
import { matchReceptionistCapabilities } from "../src/faq.js";

describe("matchReceptionistCapabilities", () => {
  it("matches meta receptionist capability questions", () => {
    const r = matchReceptionistCapabilities("What can you do as a receptionist?");
    expect(r).toBeTruthy();
    expect(r).toContain("Availability");
    expect(r).toContain("Booking");
  });

  it("does not match concrete scheduling requests", () => {
    expect(
      matchReceptionistCapabilities("Book a telehealth slot for Mrs. Chen next Tuesday"),
    ).toBeNull();
  });

  it("does not match empty or huge strings", () => {
    expect(matchReceptionistCapabilities("short")).toBeNull();
    expect(matchReceptionistCapabilities("x".repeat(500))).toBeNull();
  });
});
