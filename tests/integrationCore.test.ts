import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appointmentChangeAction,
  bookAppointmentAction,
  getAvailabilityAction,
} from "../src/core/actions.js";
import { closeDb } from "../src/db.js";
import { listPendingOutbox } from "../src/integrations/outbox.js";

describe("integration core actions", () => {
  let dir: string;
  let prevDataDir: string | undefined;
  let prevPilot: string | undefined;

  beforeEach(() => {
    closeDb();
    dir = mkdtempSync(path.join(tmpdir(), "gh-core-"));
    prevDataDir = process.env.DATA_DIR;
    prevPilot = process.env.PILOT_MODE;
    process.env.DATA_DIR = dir;
    process.env.PILOT_MODE = "off";
  });

  afterEach(() => {
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    process.env.PILOT_MODE = prevPilot;
    rmSync(dir, { recursive: true, force: true });
  });

  it("availability action returns slots and summary", async () => {
    const out = await getAvailabilityAction({
      actorId: "U1",
      sessionKey: "U1:T1",
      authorizationScopes: ["availability:read"],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.slots.length).toBeGreaterThan(0);
    expect(out.data.summary).toContain("•");
  });

  it("book action is idempotent for same key", async () => {
    const first = await bookAppointmentAction(
      {
        actorId: "U1",
        sessionKey: "U1:T1",
        authorizationScopes: ["availability:read", "booking:write"],
        idempotencyKey: "idem-1",
      },
      { rawText: "Book me for Thursday at 9am", whenHint: "Thursday 9am", patientRef: "GH-1001" },
    );
    const second = await bookAppointmentAction(
      {
        actorId: "U1",
        sessionKey: "U1:T1",
        authorizationScopes: ["availability:read", "booking:write"],
        idempotencyKey: "idem-1",
      },
      { rawText: "Book me for Thursday at 9am", whenHint: "Thursday 9am", patientRef: "GH-1001" },
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.data.appointmentId).toBe(second.data.appointmentId);
  });

  it("appointment change action emits outbox event", async () => {
    const booked = await bookAppointmentAction(
      {
        actorId: "U1",
        sessionKey: "U1:T1",
        authorizationScopes: ["availability:read", "booking:write", "appointments:write"],
      },
      { rawText: "Book me for Thursday at 10am", whenHint: "Thursday 10am", patientRef: "GH-2222" },
    );
    expect(booked.ok).toBe(true);
    const changed = await appointmentChangeAction(
      {
        actorId: "U1",
        sessionKey: "U1:T1",
        authorizationScopes: ["appointments:write"],
      },
      { action: "cancel", publicRef: "GH-2222" },
    );
    expect(changed.ok).toBe(true);
    const pending = listPendingOutbox(20);
    expect(pending.some((x) => x.topic === "appointment.changed")).toBe(true);
  });

  it("shadow mode avoids live writes and returns shadow ids", async () => {
    process.env.PILOT_MODE = "shadow";
    const out = await bookAppointmentAction(
      {
        actorId: "U1",
        sessionKey: "U1:T1",
        authorizationScopes: ["availability:read", "booking:write"],
      },
      { rawText: "book me tomorrow 9am", whenHint: "Thursday 9am", patientRef: "GH-3001" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.appointmentId.startsWith("SHADOW-")).toBe(true);
  });
});
