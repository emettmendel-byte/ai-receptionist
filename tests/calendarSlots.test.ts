import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { listOpenCalendarSlots, pickOpenSlotForBooking } from "../src/calendarSlots.js";

describe("calendarSlots", () => {
  const clinic = {
    timezone: "America/New_York",
    visit_types: ["CCM"],
    slot_length_minutes: 120,
    blocks: [{ weekday: 3, start: "10:00", end: "12:00", label: "Wed test" }],
  };

  it("listOpenCalendarSlots returns dated labels from blocks", () => {
    const fixed = DateTime.fromISO("2026-04-01T12:00:00", { zone: "America/New_York" });
    const open = listOpenCalendarSlots({
      bookedSlotLabels: new Set(),
      daysAhead: 14,
      clinic,
      now: fixed,
    });
    expect(open.length).toBeGreaterThan(0);
    expect(open[0].label).toMatch(/2026/);
    expect(open[0].key).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("pickOpenSlotForBooking matches weekday and hour", () => {
    const fixed = DateTime.fromISO("2026-04-01T12:00:00", { zone: "America/New_York" });
    const open = listOpenCalendarSlots({
      bookedSlotLabels: new Set(),
      daysAhead: 14,
      clinic,
      now: fixed,
    });
    const picked = pickOpenSlotForBooking("Book me Wednesday at 10am", undefined, open);
    expect(picked).toBeTruthy();
    expect(picked!.label.toLowerCase()).toContain("wed");
  });
});
