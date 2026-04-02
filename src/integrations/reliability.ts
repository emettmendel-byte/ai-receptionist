import { config } from "../config.js";

type CircuitState = {
  failures: number;
  openedUntilMs: number;
};

const circuits = new Map<string, CircuitState>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\bretryable\b/i.test(err.message) || /\btimeout\b/i.test(err.message);
}

export async function withProviderReliability<T>(
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const circuit = circuits.get(operationName) ?? { failures: 0, openedUntilMs: 0 };
  if (circuit.openedUntilMs > now) {
    throw new Error(`retryable:circuit_open:${operationName}`);
  }

  const maxRetries = Math.max(0, config.integrationRetries);
  let attempt = 0;
  // attempt=0 is first try, then retries.
  while (attempt <= maxRetries) {
    try {
      const out = await fn();
      circuits.set(operationName, { failures: 0, openedUntilMs: 0 });
      return out;
    } catch (err) {
      attempt += 1;
      const retryable = isRetryableError(err);
      if (!retryable || attempt > maxRetries) {
        const nextFailures = circuit.failures + 1;
        const open =
          nextFailures >= config.integrationCircuitFailures
            ? Date.now() + config.integrationCircuitOpenMs
            : 0;
        circuits.set(operationName, { failures: nextFailures, openedUntilMs: open });
        throw err;
      }
      const delay = config.integrationRetryBaseMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  throw new Error(`retryable:exhausted:${operationName}`);
}

export function resetReliabilityStateForTests(): void {
  circuits.clear();
}
