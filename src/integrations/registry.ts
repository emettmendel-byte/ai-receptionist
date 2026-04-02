import { config } from "../config.js";
import { stubIntegrationProvider } from "./stubProvider.js";
import type { IntegrationProvider } from "./types.js";

let cached: IntegrationProvider | null = null;
let cachedName = "";

function buildProvider(name: string): IntegrationProvider {
  switch (name) {
    case "stub":
      return stubIntegrationProvider;
    default:
      throw new Error(
        `Unsupported integration provider '${name}'. Set INTEGRATION_PROVIDER=stub for now.`,
      );
  }
}

export function getIntegrationProvider(): IntegrationProvider {
  const name = config.integrationProvider;
  if (cached && cachedName === name) return cached;
  cached = buildProvider(name);
  cachedName = name;
  return cached;
}

export function resetIntegrationProviderForTests(): void {
  cached = null;
  cachedName = "";
}
