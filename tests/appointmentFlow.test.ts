import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookAppointment } from "../src/appointments.js";
import { closeDb } from "../src/db.js";
import { advanceAppointmentFlow } from "../src/flows/appointmentFlow.js";

describe("advanceAppointmentFlow", () => {
  let dir: string;

  beforeEach(() => {
    closeDb();
    dir = mkdtempSync(path.join(tmpdir(), "gh-apptflow-"));
    process.env.DATA_DIR = dir;
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("completes cancel in one turn when action and patient ref present", () => {
    const b = bookAppointment({
      slotLabel: "Thu 10am Demo",
      patientRef: "GH-9911",
      userId: "U1",
    });
    expect(b.ok).toBe(true);

    const r = advanceAppointmentFlow(undefined, "Cancel appointment GH-9911 for Mrs. Lee", {});
    expect(r.flow).toBeNull();
    expect(r.message).toContain("cancelled");
    expect(r.message).toContain(b.id);
  });

  it("asks for time on reschedule then completes on follow-up", () => {
    bookAppointment({
      slotLabel: "Mon 9am Demo",
      patientRef: "GH-2001",
      userId: "U1",
    });

    const a = advanceAppointmentFlow(undefined, "Reschedule GH-2001", {});
    expect(a.flow).not.toBeNull();
    expect(a.message).toMatch(/time|window/i);

    const b = advanceAppointmentFlow(a.flow!, "next Wednesday 2pm", {});
    expect(b.flow).toBeNull();
    expect(b.message).toContain("rescheduled");
    expect(b.message).toMatch(/New time:.*2:00 PM/i);
  });
});
