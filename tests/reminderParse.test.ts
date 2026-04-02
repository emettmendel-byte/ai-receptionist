import { describe, expect, it } from "vitest";
import { resolvePostAt } from "../src/reminderParse.js";

/**
 * ## What this suite tests
 * `resolvePostAt` turns NLU time hints (`when` / `when_iso`) plus a fixed clock into a Slack
 * `post_at` unix timestamp. That value is what we pass to `chat.scheduleMessage`.
 *
 * ## Inputs
 * - `when`: free text, often copied from the user message or entity `when`
 * - `when_iso`: optional ISO timestamp from the classifier
 * - `now`: frozen `Date` in tests (real code uses `new Date()`)
 *
 * ## Expected outputs
 * - Either `{ postAt: unixSeconds, label: string }` or `null` if no valid future time
 * - Relative phrases like "in N minutes" must respect a minimum ~60s lead time for Slack
 */

describe("resolvePostAt (reminder / scheduler input)", () => {
  /*
   * Input: `when: "in 2 minutes"`, fixed `now` at 2026-04-01T12:00:00Z, no `when_iso`.
   * Expected: non-null; `postAt` = now + 120 seconds; label mentions minutes.
   */
  it("parses 'in 2 minutes' and applies at least 60s skew", () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const r = resolvePostAt({ when: "in 2 minutes", now });
    expect(r).not.toBeNull();
    expect(r!.postAt).toBe(Math.floor(now.getTime() / 1000) + 120);
    expect(r!.label).toContain("minute");
  });

  /*
   * Input: `when: "in 30 seconds"` — shorter than Slack-safe minimum (60s).
   * Expected: non-null but `postAt` is bumped to now + 60 seconds (not +30).
   */
  it("bumps 'in 30 seconds' up to 60 seconds minimum", () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const r = resolvePostAt({ when: "in 30 seconds", now });
    expect(r).not.toBeNull();
    expect(r!.postAt).toBe(Math.floor(now.getTime() / 1000) + 60);
  });

  /*
   * Input: `when: "whenever"` (no relative pattern, no usable `when_iso`).
   * Expected: `null` so the bot can ask the user for a parseable time.
   */
  it("returns null when no time can be inferred", () => {
    const r = resolvePostAt({ when: "whenever", now: new Date() });
    expect(r).toBeNull();
  });

  /*
   * Input: `when_iso` three hours after fixed `now`, no relative `when` needed.
   * Expected: non-null; `postAt` equals that instant in unix seconds (and is after now+60s).
   */
  it("accepts when_iso in the future", () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const iso = "2026-04-01T15:00:00.000Z";
    const r = resolvePostAt({ when_iso: iso, now });
    expect(r).not.toBeNull();
    expect(r!.postAt).toBe(Math.floor(new Date(iso).getTime() / 1000));
  });
});
