import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";

type TranscribeOk = { ok: true; text: string };
type TranscribeErr = { ok: false; error: string };

function extensionFromFilename(filename: string): string {
  const m = filename.match(/(\.[a-zA-Z0-9]{1,12})$/);
  return m ? m[1].toLowerCase() : ".bin";
}

function runPythonTranscribe(args: {
  python: string;
  script: string;
  audioPath: string;
  model: string;
  timeoutMs: number;
}): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(args.python, [args.script, args.audioPath, args.model], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, args.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

/**
 * Write audio to a temp file and run scripts/transcribe_faster_whisper.py via the configured venv python.
 */
export async function transcribeWithLocalFasterWhisper(
  audio: Buffer,
  filename: string,
): Promise<TranscribeOk | TranscribeErr> {
  const python = config.fasterWhisperPython;
  const script = config.fasterWhisperScript;
  if (!python.trim()) {
    return { ok: false, error: "FASTER_WHISPER_PYTHON is not set" };
  }

  const ext = extensionFromFilename(filename);
  const dir = mkdtempSync(join(tmpdir(), "gh-fw-"));
  const audioPath = join(dir, `slack-audio${ext}`);

  try {
    writeFileSync(audioPath, audio);
    const { stdout, stderr, code, timedOut } = await runPythonTranscribe({
      python,
      script,
      audioPath,
      model: config.fasterWhisperModel,
      timeoutMs: config.fasterWhisperTimeoutMs,
    });

    if (timedOut) {
      return {
        ok: false,
        error: `Local Whisper timed out after ${config.fasterWhisperTimeoutMs}ms`,
      };
    }

    if (code !== 0) {
      const hint = stderr.trim() || `exit code ${code}`;
      return { ok: false, error: `Local Whisper failed: ${hint.slice(0, 400)}` };
    }

    const text = stdout.trim();
    if (!text) {
      return { ok: false, error: "Local Whisper returned empty stdout" };
    }
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Local Whisper spawn error: ${msg}` };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
