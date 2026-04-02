import { ollamaChat } from "./ollama.js";

export async function answerFaqGeneric(question: string): Promise<string> {
  const text = await ollamaChat({
    messages: [
      {
        role: "system",
        content:
          "You are a Greens Health care operations assistant (CCM/RPM). Give concise, practical guidance. " +
          "If you do not know org-specific policy, say it's demo content and suggest verifying with ops. " +
          "Do not invent patient data or PHI.",
      },
      { role: "user", content: question },
    ],
    temperature: 0.3,
    numPredict: 400,
  });
  return text || "I do not have an answer in the demo KB.";
}
