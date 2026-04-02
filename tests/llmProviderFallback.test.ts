import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaChat } from "../src/llm/ollama.js";

describe("llm provider fallback (Gemini -> Ollama)", () => {
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevGeminiModel = process.env.GEMINI_MODEL;
  const prevGeminiBase = process.env.GEMINI_API_BASE;
  const prevOllamaHost = process.env.OLLAMA_HOST;
  const prevOllamaModel = process.env.OLLAMA_MODEL;

  afterEach(() => {
    process.env.GEMINI_API_KEY = prevGeminiKey;
    process.env.GEMINI_MODEL = prevGeminiModel;
    process.env.GEMINI_API_BASE = prevGeminiBase;
    process.env.OLLAMA_HOST = prevOllamaHost;
    process.env.OLLAMA_MODEL = prevOllamaModel;
    vi.restoreAllMocks();
  });

  it("uses Gemini when key is set and call succeeds", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    process.env.GEMINI_MODEL = "gemini-1.5-flash";
    process.env.GEMINI_API_BASE = "https://example-gemini.test/v1beta";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: "from-gemini" }] } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await ollamaChat({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(out).toBe("from-gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/models/gemini-1.5-flash:generateContent");
  });

  it("falls back to Ollama when Gemini fails", async () => {
    process.env.GEMINI_API_KEY = "g-test";
    process.env.GEMINI_MODEL = "gemini-1.5-flash";
    process.env.GEMINI_API_BASE = "https://example-gemini.test/v1beta";
    process.env.OLLAMA_HOST = "http://example-ollama.test:11434";
    process.env.OLLAMA_MODEL = "llama3.2:latest";

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("generateContent")) {
        return {
          ok: false,
          status: 503,
          text: async () => "gemini down",
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ message: { content: "from-ollama" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await ollamaChat({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(out).toBe("from-ollama");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/chat");
  });

  it("uses Ollama directly when Gemini key is missing", async () => {
    process.env.GEMINI_API_KEY = "";
    process.env.OLLAMA_HOST = "http://example-ollama.test:11434";
    process.env.OLLAMA_MODEL = "llama3.2:latest";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ message: { content: "ollama-only" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await ollamaChat({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(out).toBe("ollama-only");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/chat");
  });
});
