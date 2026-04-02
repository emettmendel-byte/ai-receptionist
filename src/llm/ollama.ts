import { config } from "../config.js";

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OllamaChatResponse = {
  message?: { role?: string; content?: string };
  error?: string;
};

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

function geminiRole(role: OllamaChatMessage["role"]): "user" | "model" {
  return role === "assistant" ? "model" : "user";
}

async function geminiChat(args: {
  messages: OllamaChatMessage[];
  formatJson?: boolean;
  temperature?: number;
  numPredict?: number;
}): Promise<string> {
  const key = config.geminiApiKey.trim();
  if (!key) {
    throw new Error("Gemini API key is missing.");
  }
  const base = config.geminiApiBase.replace(/\/$/, "");
  const model = config.geminiModel;
  const endpoint = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const body: Record<string, unknown> = {
    contents: args.messages.map((m) => ({
      role: geminiRole(m.role),
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: args.temperature ?? 0.2,
      ...(args.numPredict != null ? { maxOutputTokens: args.numPredict } : {}),
      ...(args.formatJson ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  let data: GeminiGenerateContentResponse;
  try {
    data = JSON.parse(text) as GeminiGenerateContentResponse;
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (data.error?.message) {
    throw new Error(`Gemini: ${data.error.message}`);
  }
  const out =
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";
  if (!out) throw new Error("Gemini returned empty content.");
  return out;
}

async function ollamaDirect(args: {
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

export async function ollamaChat(args: {
  messages: OllamaChatMessage[];
  /** When set, Ollama constrains output to JSON (model permitting). */
  formatJson?: boolean;
  temperature?: number;
  numPredict?: number;
}): Promise<string> {
  if (config.geminiApiKey.trim()) {
    try {
      return await geminiChat(args);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] Gemini failed, falling back to Ollama: ${reason}`);
      return ollamaDirect(args);
    }
  }
  return ollamaDirect(args);
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
