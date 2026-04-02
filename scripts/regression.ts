/**
 * Offline regression: prints intent + confidence for golden phrases.
 * Requires Ollama running with the configured model (default llama3.2:latest).
 * Run: npm run regression
 */
import "dotenv/config";
import { config } from "../src/config.js";
import { GOLDEN_PHRASES, type IntentId } from "../src/intents.js";
import { classifyTurn } from "../src/llm/classify.js";
import type { ChatTurn } from "../src/types.js";

async function main(): Promise<void> {
  const ping = await fetch(`${config.ollamaHost.replace(/\/$/, "")}/api/tags`).catch(() => null);
  if (!ping?.ok) {
    console.error(
      `Ollama does not appear reachable at ${config.ollamaHost}. Start Ollama and run: ollama pull ${config.ollamaModel}`,
    );
    process.exit(1);
  }

  const rows: { expected: IntentId; phrase: string; got: string; conf: number }[] = [];

  for (const intent of Object.keys(GOLDEN_PHRASES) as IntentId[]) {
    for (const phrase of GOLDEN_PHRASES[intent]) {
      const turns: ChatTurn[] = [];
      const c = await classifyTurn(turns, phrase);
      rows.push({ expected: intent, phrase, got: c.intent, conf: c.confidence });
      console.log(`${intent.padEnd(18)} exp=${intent} got=${c.intent} conf=${c.confidence.toFixed(2)}`);
      console.log(`  "${phrase.slice(0, 72)}${phrase.length > 72 ? "…" : ""}"`);
    }
  }

  const mismatches = rows.filter((r) => r.got !== r.expected);
  console.log("\n---");
  console.log(`Mismatches: ${mismatches.length} / ${rows.length}`);
  for (const m of mismatches) {
    console.log(`• expected ${m.expected}, got ${m.got} (${m.conf.toFixed(2)}): ${m.phrase.slice(0, 60)}…`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
