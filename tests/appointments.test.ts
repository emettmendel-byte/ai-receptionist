import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bookAppointment,
  cancelAppointmentByRef,
  listActiveBookedSlotKeys,
  normalizeSlotLabel,
  rescheduleAppointmentByRef,
} from "../src/appointments.js";
import { closeDb } from "../src/db.js";

describe("appointments ledger", () => {
  let dir: string;

  beforeEach(() => {
    closeDb();
    dir = mkdtempSync(path.join(tmpdir(), "gh-appt-"));
    process.env.DATA_DIR = dir;
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("bookAppointment occupies slot; second book same slot fails", () => {
    const a = bookAppointment({ slotLabel: "Tue 2pm", patientRef: "GH-1" });
    expect(a.ok).toBe(true);
    expect(listActiveBookedSlotKeys().has(normalizeSlotLabel("Tue 2pm"))).toBe(true);

    const b = bookAppointment({ slotLabel: "Tue 2pm", patientRef: "GH-2" });
    expect(b.ok).toBe(false);
    expect(b.reason).toBe("slot_taken");
  });

  it("cancel frees slot; reschedule moves booking", () => {
    const a = bookAppointment({ slotLabel: "Wed 3pm", patientRef: "GH-9" });
    expect(a.ok).toBe(true);

    const c = cancelAppointmentByRef(a.id);
    expect(c.ok).toBe(true);
    expect(listActiveBookedSlotKeys().has(normalizeSlotLabel("Wed 3pm"))).toBe(false);

    const a2 = bookAppointment({ slotLabel: "Wed 3pm", patientRef: "GH-9" });
    expect(a2.ok).toBe(true);

    const r = rescheduleAppointmentByRef(a2.id, "Fri 4pm");
    expect(r.ok).toBe(true);
    expect(r.new_slot).toBe("Fri 4pm");
    expect(listActiveBookedSlotKeys().has(normalizeSlotLabel("Wed 3pm"))).toBe(false);
    expect(listActiveBookedSlotKeys().has(normalizeSlotLabel("Fri 4pm"))).toBe(true);
  });
});
