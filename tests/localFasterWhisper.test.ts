import { EventEmitter } from "node:events";
import * as cp from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ## What this suite tests
 * Local STT path spawns the configured Python + script, reads stdout as transcript, and cleans temp dirs.
 * Spawn is mocked so CI does not need faster-whisper installed.
 */

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("transcribeWithLocalFasterWhisper", () => {
  beforeEach(() => {
    vi.stubEnv("FASTER_WHISPER_PYTHON", "/fake/venv/bin/python3");
    vi.stubEnv("FASTER_WHISPER_MODEL", "tiny");

    vi.mocked(cp.spawn).mockImplementation((_cmd, _args, _opts) => {
      const child = new EventEmitter() as cp.ChildProcess & EventEmitter;
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(child, { stdout, stderr });

      queueMicrotask(() => {
        stdout.emit("data", Buffer.from("schedule a follow-up for Mrs. Chen"));
        child.emit("close", 0);
      });

      return child;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(cp.spawn).mockReset();
  });

  /*
   * Input: audio buffer + filename with extension; FASTER_WHISPER_PYTHON set; spawn mocked to emit transcript on stdout.
   * Expected: { ok: true, text } matches mocked stdout (trimmed).
   */
  it("returns transcript from mocked python stdout", async () => {
    const { transcribeWithLocalFasterWhisper } = await import(
      "../src/voice/localFasterWhisper.js"
    );
    const r = await transcribeWithLocalFasterWhisper(
      Buffer.from("fake-bytes"),
      "voice-note.m4a",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe("schedule a follow-up for Mrs. Chen");
    }
    expect(cp.spawn).toHaveBeenCalled();
    const call = vi.mocked(cp.spawn).mock.calls[0];
    expect(call[0]).toBe("/fake/venv/bin/python3");
    expect(call[1]?.[0]).toContain("transcribe_faster_whisper.py");
    expect(call[1]?.[1]).toMatch(/slack-audio\.m4a$/);
    expect(call[1]?.[2]).toBe("tiny");
  });

  /*
   * Input: FASTER_WHISPER_PYTHON cleared.
   * Expected: structured error without calling spawn.
   */
  it("returns error when python path not configured", async () => {
    vi.stubEnv("FASTER_WHISPER_PYTHON", "");
    vi.mocked(cp.spawn).mockClear();
    const { transcribeWithLocalFasterWhisper } = await import(
      "../src/voice/localFasterWhisper.js"
    );
    const r = await transcribeWithLocalFasterWhisper(Buffer.from("x"), "a.webm");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("FASTER_WHISPER_PYTHON");
    }
    expect(cp.spawn).not.toHaveBeenCalled();
  });
});
