import { mkdtempSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeSlotLabel } from "../src/appointments.js";
import { getSlotSuggestions } from "../src/availability.js";

describe("availability (clinic rules stub)", () => {
  let dir: string;
  let prev: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "gh-clinic-"));
    prev = process.env.CLINIC_HOURS_PATH;
    const p = path.join(dir, "clinic.json");
    writeFileSync(
      p,
      JSON.stringify({
        visit_types: ["CCM"],
        primary_slot_hint: "Custom primary",
        alternate_slots: ["Alt A", "Alt B"],
      }),
    );
    process.env.CLINIC_HOURS_PATH = p;
  });

  afterEach(() => {
    process.env.CLINIC_HOURS_PATH = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("getSlotSuggestions uses config primary and alternates", () => {
    const s = getSlotSuggestions({ whenHint: "" });
    expect(s.primary).toBe("Custom primary");
    expect(s.alternates).toEqual(["Alt A", "Alt B"]);
    expect(s.visit_types).toEqual(["CCM"]);
    expect(s.note).toContain("Prototype");
  });

  it("getSlotSuggestions prefers whenHint for primary display", () => {
    const s = getSlotSuggestions({ whenHint: "Tuesday 9am" });
    expect(s.primary).toBe("Tuesday 9am");
  });

  it("getSlotSuggestions skips booked template slots", () => {
    const booked = new Set<string>([normalizeSlotLabel("Custom primary")]);
    const s = getSlotSuggestions({ whenHint: "", bookedSlots: booked });
    expect(s.primary).toBe("Alt A");
    expect(s.alternates).toEqual(["Alt B"]);
  });
});
