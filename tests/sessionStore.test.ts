import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../src/db.js";
import {
  appendTurn,
  loadSession,
  saveSession,
  sessionKey,
} from "../src/sessionStore.js";

/**
 * ## What this suite tests
 * Conversation state persisted in SQLite, keyed by **Slack user id + parent thread timestamp**
 * (same key shape the live bot uses). This is the “memory” the classifier sees via recent turns.
 *
 * ## Inputs
 * - `sessionKey(userId, threadTs)` strings
 * - `appendTurn` / `saveSession` writes
 * - `loadSession` reads
 *
 * ## Expected outputs
 * - Empty state for unknown keys
 * - Same key returns accumulated turns; different keys stay isolated
 * - `saveSession` round-trips `clarify_count` and `last_intent`
 *
 * Each test uses a fresh temp `DATA_DIR` and closes the DB so files do not leak between cases.
 */

describe("sessionStore (stateful conversation memory)", () => {
  let dir: string;

  beforeEach(() => {
    closeDb();
    dir = mkdtempSync(path.join(tmpdir(), "gh-receptionist-"));
    process.env.DATA_DIR = dir;
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  /*
   * Input: user id `"U1"`, thread ts `"123.456"`.
   * Expected: single string `"U1:123.456"` (stable session id for that thread).
   */
  it("sessionKey joins user id and thread ts", () => {
    expect(sessionKey("U1", "123.456")).toBe("U1:123.456");
  });

  /*
   * Input: `loadSession` for a key that was never written.
   * Expected: `turns: []`, `clarify_count: 0` (default empty session).
   */
  it("loadSession returns empty state for unknown key", () => {
    const s = loadSession("U9:999.888");
    expect(s.turns).toEqual([]);
    expect(s.clarify_count).toBe(0);
  });

  /*
   * Input: same key `"U1:111.222"` — two `appendTurn` calls (user then assistant).
   * Expected: `loadSession` returns both turns in order with correct role/text.
   */
  it("appendTurn and loadSession retain history for the same session key", () => {
    const key = "U1:111.222";
    appendTurn(key, "user", "First message");
    appendTurn(key, "assistant", "Reply");
    const s = loadSession(key);
    expect(s.turns).toHaveLength(2);
    expect(s.turns[0].role).toBe("user");
    expect(s.turns[0].text).toBe("First message");
    expect(s.turns[1].text).toBe("Reply");
  });

  /*
   * Input: two different keys under the same user (`U1:A.A` vs `U1:B.B`) with one user turn each.
   * Expected: thread A only sees "thread A"; thread B only sees "thread B" (no cross-thread bleed).
   */
  it("different session keys do not share turns", () => {
    appendTurn("U1:A.A", "user", "thread A");
    appendTurn("U1:B.B", "user", "thread B");
    expect(loadSession("U1:A.A").turns).toHaveLength(1);
    expect(loadSession("U1:B.B").turns[0].text).toBe("thread B");
  });

  /*
   * Input: `saveSession` with explicit `clarify_count: 2`, `last_intent: "faq"`, empty turns.
   * Expected: `loadSession` returns those fields unchanged (metadata persistence).
   */
  it("saveSession persists clarify_count and last_intent", () => {
    const key = "U2:333.444";
    saveSession(key, {
      turns: [],
      clarify_count: 2,
      last_intent: "faq",
    });
    const s = loadSession(key);
    expect(s.clarify_count).toBe(2);
    expect(s.last_intent).toBe("faq");
  });
});
