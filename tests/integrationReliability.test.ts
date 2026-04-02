import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db.js";
import { claimIdempotency, completeIdempotency } from "../src/integrations/idempotency.js";
import {
  enqueueIntegrationEvent,
  listPendingOutbox,
  markOutboxDispatched,
  markOutboxError,
} from "../src/integrations/outbox.js";
import {
  resetReliabilityStateForTests,
  withProviderReliability,
} from "../src/integrations/reliability.js";

describe("integration reliability", () => {
  let dir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    closeDb();
    resetReliabilityStateForTests();
    dir = mkdtempSync(path.join(tmpdir(), "gh-rel-"));
    prevDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
  });

  afterEach(() => {
    closeDb();
    process.env.DATA_DIR = prevDataDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it("idempotency replays stored response", () => {
    const c1 = claimIdempotency("book", "k1");
    expect(c1.status).toBe("new");
    completeIdempotency("book", "k1", { ok: true, data: { id: "A1" } });
    const c2 = claimIdempotency("book", "k1");
    expect(c2.status).toBe("replay");
    if (c2.status !== "replay") return;
    expect((c2.response as { data: { id: string } }).data.id).toBe("A1");
  });

  it("outbox lifecycle records and updates events", () => {
    const id = enqueueIntegrationEvent("appointment.booked", { id: "A1" });
    let pending = listPendingOutbox(10);
    expect(pending.some((x) => x.id === id)).toBe(true);
    markOutboxError(id, "temporary failure");
    pending = listPendingOutbox(10);
    expect(pending.some((x) => x.id === id)).toBe(true);
    markOutboxDispatched(id);
    pending = listPendingOutbox(10);
    expect(pending.some((x) => x.id === id)).toBe(false);
  });

  it("retries retryable errors and then succeeds", async () => {
    let n = 0;
    const out = await withProviderReliability("eligibility", async () => {
      n += 1;
      if (n < 2) throw new Error("retryable timeout");
      return "ok";
    });
    expect(out).toBe("ok");
    expect(n).toBe(2);
  });
});
