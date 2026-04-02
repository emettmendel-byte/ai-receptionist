/**
 * ## LLM-as-judge helper
 *
 * **Input**
 * - `criterion`: natural-language rubric (what “pass” means for this scenario).
 * - `userMessage`: the raw user text that was classified.
 * - `actual`: the classifier’s structured output (typically `Classification` JSON).
 *
 * **Output**
 * - Calls Ollama `POST /api/chat` with `format: "json"` and parses `{ pass, score, reasoning }`.
 * - On HTTP/parse failure, returns `{ pass: false, score: 0, reasoning: "<error>" }`.
 *
 * Used from `tests/nlu.judge.test.ts` when `RUN_LLM_TESTS=1` (or `npm run test:llm`).
 */
import { config } from "../../src/config.js";
import { extractJsonObject } from "../../src/llm/ollama.js";

export type JudgeResult = {
  pass: boolean;
  score: number;
  reasoning: string;
};

const judgeModel = () => process.env.JUDGE_MODEL ?? config.ollamaModel;

export async function llmAsJudge(input: {
  /** What “good” looks like for this case. */
  criterion: string;
  userMessage: string;
  actual: unknown;
}): Promise<JudgeResult> {
  const base = config.ollamaHost.replace(/\/$/, "");
  const actualStr = JSON.stringify(input.actual, null, 2);

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: judgeModel(),
      stream: false,
      format: "json",
      messages: [
        {
          role: "system",
          content:
            "You grade NLU outputs for a healthcare receptionist bot. " +
            "Be strict but fair: pass only if the actual output clearly satisfies the criterion. " +
            "Respond with JSON only: {\"pass\": boolean, \"score\": number between 0 and 1, \"reasoning\": string (one or two sentences)}.",
        },
        {
          role: "user",
          content:
            `Criterion:\n${input.criterion}\n\nUser message:\n${input.userMessage}\n\nActual NLU JSON:\n${actualStr}`,
        },
      ],
      options: { temperature: 0.1, num_predict: 256 },
    }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    return {
      pass: false,
      score: 0,
      reasoning: `Judge request failed HTTP ${res.status}: ${rawText.slice(0, 200)}`,
    };
  }

  let content: string;
  try {
    const data = JSON.parse(rawText) as { message?: { content?: string } };
    content = data.message?.content?.trim() ?? "";
  } catch {
    return { pass: false, score: 0, reasoning: "Judge response was not valid JSON envelope." };
  }

  try {
    const parsed = JSON.parse(extractJsonObject(content || "{}")) as Record<string, unknown>;
    const pass = Boolean(parsed.pass);
    const score = Math.min(1, Math.max(0, Number(parsed.score) || 0));
    const reasoning =
      typeof parsed.reasoning === "string" ? parsed.reasoning : "No reasoning from judge.";
    return { pass, score, reasoning };
  } catch {
    return {
      pass: false,
      score: 0,
      reasoning: `Could not parse judge JSON from: ${content.slice(0, 160)}`,
    };
  }
}
