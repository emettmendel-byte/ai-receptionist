import { describe, expect, it } from "vitest";
import { getIntegrationProvider, resetIntegrationProviderForTests } from "../src/integrations/registry.js";

describe("integration provider registry", () => {
  it("loads stub provider by default", () => {
    const prev = process.env.INTEGRATION_PROVIDER;
    process.env.INTEGRATION_PROVIDER = "stub";
    resetIntegrationProviderForTests();
    const p = getIntegrationProvider();
    expect(p.name).toBe("stub");
    process.env.INTEGRATION_PROVIDER = prev;
  });

  it("throws for unsupported providers", () => {
    const prev = process.env.INTEGRATION_PROVIDER;
    process.env.INTEGRATION_PROVIDER = "unknown_provider";
    resetIntegrationProviderForTests();
    expect(() => getIntegrationProvider()).toThrow();
    process.env.INTEGRATION_PROVIDER = prev;
  });

  it("caches provider for same env value", () => {
    const prev = process.env.INTEGRATION_PROVIDER;
    process.env.INTEGRATION_PROVIDER = "stub";
    resetIntegrationProviderForTests();
    const a = getIntegrationProvider();
    const b = getIntegrationProvider();
    expect(a).toBe(b);
    process.env.INTEGRATION_PROVIDER = prev;
  });
});
