import path from "node:path";
import "dotenv/config";

export const config = {
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  slackAppToken: process.env.SLACK_APP_TOKEN ?? "",
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET ?? "",
  get ollamaHost() {
    return process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  },
  get ollamaModel() {
    return process.env.OLLAMA_MODEL ?? "llama3.2:latest";
  },
  confidenceThreshold: Number(process.env.CONFIDENCE_THRESHOLD ?? "0.65"),
  get dataDir() {
    return process.env.DATA_DIR ?? "./data";
  },
  escalationChannelId: process.env.ESCALATION_CHANNEL_ID ?? "",
  maxTurns: Number(process.env.MAX_SESSION_TURNS ?? "12"),
  maxClarify: Number(process.env.MAX_CLARIFY_ROUNDS ?? "3"),
  /** Optional: OpenAI Whisper (or compatible) for Slack voice/audio clips only. */
  get whisperApiKey() {
    return process.env.WHISPER_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  },
  get whisperApiUrl() {
    return (
      process.env.WHISPER_API_URL ?? "https://api.openai.com/v1/audio/transcriptions"
    );
  },
  get whisperModel() {
    return process.env.WHISPER_MODEL ?? "whisper-1";
  },
  /** Absolute path to venv python with faster-whisper installed (e.g. .../faster-whisper/bin/python3). */
  get fasterWhisperPython() {
    return process.env.FASTER_WHISPER_PYTHON ?? "";
  },
  /** Path to scripts/transcribe_faster_whisper.py (default: cwd/scripts/...). */
  get fasterWhisperScript() {
    return (
      process.env.FASTER_WHISPER_SCRIPT ??
      path.join(process.cwd(), "scripts", "transcribe_faster_whisper.py")
    );
  },
  get fasterWhisperModel() {
    return process.env.FASTER_WHISPER_MODEL ?? "small";
  },
  get fasterWhisperTimeoutMs() {
    return Number(process.env.FASTER_WHISPER_TIMEOUT_MS ?? "180000");
  },
};

export function assertSlackEnv(): void {
  const need = [
    ["SLACK_BOT_TOKEN", config.slackBotToken],
    ["SLACK_APP_TOKEN", config.slackAppToken],
    ["SLACK_SIGNING_SECRET", config.slackSigningSecret],
  ] as const;
  const missing = need.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing required env for Slack bot: ${missing.join(", ")}`);
  }
}
