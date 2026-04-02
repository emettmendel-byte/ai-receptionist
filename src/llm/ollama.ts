import { config } from "../config.js";

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaChatResponse = {
  message?: { role?: string; content?: string };
  error?: string;
};

export async function ollamaChat(args: {
  messages: OllamaChatMessage[];
  /** When set, Ollama constrains output to JSON (model permitting). */
  formatJson?: boolean;
  temperature?: number;
  numPredict?: number;
}): Promise<string> {
  const base = config.ollamaHost.replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages: args.messages,
      stream: false,
      ...(args.formatJson ? { format: "json" } : {}),
      options: {
        temperature: args.temperature ?? 0.2,
        ...(args.numPredict != null ? { num_predict: args.numPredict } : {}),
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  let data: OllamaChatResponse;
  try {
    data = JSON.parse(text) as OllamaChatResponse;
  } catch {
    throw new Error(`Ollama returned non-JSON: ${text.slice(0, 200)}`);
  }

  if (data.error) {
    throw new Error(`Ollama: ${data.error}`);
  }

  return data.message?.content?.trim() ?? "";
}

/** Handle fenced or noisy JSON from local models. */
export function extractJsonObject(text: string): string {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}
