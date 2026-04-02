import { config } from "../config.js";
import { transcribeWithLocalFasterWhisper } from "./localFasterWhisper.js";

/** Minimal Slack file object on `message.files` (voice clips, uploads). */
export type SlackFileLike = {
  id?: string;
  name?: string;
  filetype?: string;
  mimetype?: string;
  url_private?: string;
};

function isAudioMime(mimetype: string): boolean {
  const m = mimetype.toLowerCase();
  if (m.startsWith("audio/")) return true;
  // Some clients send short voice notes as video/webm or video/mp4
  if (m === "video/webm" || m === "video/mp4") return true;
  return false;
}

/**
 * Returns Slack file objects on the message that look like voice / audio attachments.
 * Input: raw `message` payload from Bolt (treated as a generic record).
 */
export function listAudioAttachments(message: Record<string, unknown>): SlackFileLike[] {
  const raw = message.files;
  if (!Array.isArray(raw)) return [];
  const out: SlackFileLike[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as SlackFileLike;
    const mt = f.mimetype ?? "";
    if (mt && isAudioMime(mt)) {
      out.push(f);
      continue;
    }
    const ft = (f.filetype ?? "").toLowerCase();
    if (["mp3", "m4a", "wav", "webm", "aac", "ogg", "flac", "mp4"].includes(ft)) {
      out.push(f);
    }
  }
  return out;
}

export async function downloadSlackPrivateFile(url: string, botToken: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!res.ok) {
    throw new Error(`Slack file download failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export type TranscribeOk = { ok: true; text: string };
export type TranscribeErr = { ok: false; error: string };

/**
 * OpenAI-compatible audio transcription (default: whisper-1).
 * Set WHISPER_API_KEY or OPENAI_API_KEY; optional WHISPER_API_URL for proxies.
 */
export async function transcribeWithWhisper(
  audio: Buffer,
  filename: string,
): Promise<TranscribeOk | TranscribeErr> {
  const key = config.whisperApiKey;
  if (!key) {
    return { ok: false, error: "Whisper API key not configured (WHISPER_API_KEY or OPENAI_API_KEY)" };
  }

  const form = new FormData();
  form.append("model", config.whisperModel);
  form.append("file", new Blob([new Uint8Array(audio)]), filename || "audio.bin");

  const res = await fetch(config.whisperApiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, error: `Whisper HTTP ${res.status}: ${raw.slice(0, 300)}` };
  }

  try {
    const data = JSON.parse(raw) as { text?: string };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) return { ok: false, error: "Whisper returned empty text" };
    return { ok: true, text };
  } catch {
    return { ok: false, error: `Whisper response not JSON: ${raw.slice(0, 200)}` };
  }
}

export type ResolvedInbound =
  | { kind: "text"; text: string }
  | { kind: "skip" }
  | { kind: "notify"; text: string };

/**
 * Combine channel text + first audio attachment (transcribed) into one string for NLU.
 * - Text-only → returns that text (trimmed); empty → skip.
 * - Audio → if `FASTER_WHISPER_PYTHON` is set, run local faster-whisper script; else or on failure,
 *   use cloud Whisper when `WHISPER_API_KEY` / `OPENAI_API_KEY` is set; otherwise notify with setup hints.
 */
export async function resolveInboundMessageText(
  message: Record<string, unknown>,
  botToken: string,
): Promise<ResolvedInbound> {
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const audioFiles = listAudioAttachments(message);

  if (audioFiles.length === 0) {
    if (!text) return { kind: "skip" };
    return { kind: "text", text };
  }

  const first = audioFiles[0];
  const url = first.url_private;
  if (!url) {
    return {
      kind: "notify",
      text:
        "I see an audio attachment but no download URL. Reinstall the app with the **files:read** bot scope so I can fetch voice clips.",
    };
  }

  let buf: Buffer;
  try {
    buf = await downloadSlackPrivateFile(url, botToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      kind: "notify",
      text: `Could not download the audio file from Slack (${msg}). Confirm **files:read** and that the file is not expired.`,
    };
  }

  const filename = first.name || `${first.id ?? "clip"}.${first.filetype ?? "bin"}`;

  const useLocal = config.fasterWhisperPython.trim().length > 0;
  let tr: TranscribeOk | TranscribeErr | null = null;

  if (useLocal) {
    tr = await transcribeWithLocalFasterWhisper(buf, filename);
  }

  if (!tr?.ok && config.whisperApiKey) {
    tr = await transcribeWithWhisper(buf, filename);
  }

  if (!tr?.ok) {
    const localErr = useLocal && tr ? tr.error : "";
    const hint =
      "I received a voice/audio message. To transcribe locally, set **FASTER_WHISPER_PYTHON** to your venv `python3`, install **faster-whisper** + **ffmpeg**, and keep `scripts/transcribe_faster_whisper.py` in the repo. " +
      "Or set **WHISPER_API_KEY** / **OPENAI_API_KEY** for cloud Whisper. Grant **files:read** on the Slack app.";
    const detail = localErr ? ` Local attempt: ${localErr}` : "";
    return { kind: "notify", text: hint + detail };
  }

  const combined = [text.replace(/<\@[^>]+>/g, "").trim(), tr.text].filter(Boolean).join("\n\n");
  return { kind: "text", text: combined };
}
