import { describe, expect, it } from "vitest";
import { stubCreateScheduleHold, stubLogInternalTask } from "../src/tools.js";

/**
 * ## What this suite tests
 * Stub “tool” functions that stand in for real EHR / ticketing integrations. They take entity-like
 * inputs and return **stable-shaped** objects the handler can show in Slack.
 *
 * ## Inputs / outputs (by function)
 * - `stubCreateScheduleHold`: optional `who` / `when` / `what` → `{ hold_id, suggested_window, ehr_stub }`
 * - `stubLogInternalTask`: optional `what` / `who` / `raw_notes` → `{ task_id, queue }` where
 *   `queue` is chosen by simple keyword heuristics (billing, logistics, default care coordination).
 */

describe("stub tools (schedule hold + task routing)", () => {
  /*
   * Input: empty object (no entities).
   * Expected: `hold_id` matches `GH-HOLD-` + 6 hex chars; `suggested_window` contains default
   * CCM stub text; `ehr_stub` mentions prototype / no bridge.
   */
  it("stubCreateScheduleHold returns GH-HOLD id and default window", () => {
    const r = stubCreateScheduleHold({});
    expect(r.hold_id).toMatch(/^GH-HOLD-[0-9A-F]{6}$/);
    expect(r.suggested_window).toContain("CCM");
    expect(r.ehr_stub).toContain("prototype");
  });

  /*
   * Input: `{ when: "Tuesday 10am" }`.
   * Expected: `suggested_window` is exactly that string (entity forwarded into the stub slot).
   */
  it("stubCreateScheduleHold prefers provided when", () => {
    const r = stubCreateScheduleHold({ when: "Tuesday 10am" });
    expect(r.suggested_window).toBe("Tuesday 10am");
  });

  /*
   * Input: `what` / `raw_notes` containing billing/reimbursement terms.
   * Expected: `task_id` matches `GH-TASK-` + hex; `queue` is `billing_queue`.
   */
  it("stubLogInternalTask routes billing keywords to billing_queue", () => {
    const r = stubLogInternalTask({ what: "RPM reimbursement", raw_notes: "billing question" });
    expect(r.task_id).toMatch(/^GH-TASK-[0-9A-F]{6}$/);
    expect(r.queue).toBe("billing_queue");
  });

  /*
   * Input: text about shipping a BP cuff (supplies / device).
   * Expected: `queue` is `logistics_queue`.
   */
  it("stubLogInternalTask routes supplies/cuff to logistics_queue", () => {
    const r = stubLogInternalTask({ what: "ship BP cuff", raw_notes: "" });
    expect(r.queue).toBe("logistics_queue");
  });

  /*
   * Input: generic nurse follow-up (no billing/supplies keywords).
   * Expected: `queue` is `care_coordination_queue`.
   */
  it("stubLogInternalTask defaults to care_coordination_queue", () => {
    const r = stubLogInternalTask({ what: "nurse follow-up", raw_notes: "" });
    expect(r.queue).toBe("care_coordination_queue");
  });
});
