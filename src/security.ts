import { config } from "./config.js";

const REDACT_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{16}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

export function redactText(input: string): string {
  if (!config.redactLogs) return input;
  let out = input;
  for (const re of REDACT_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((x) => redactUnknown(x));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = /(ssn|email|phone|member|patient)/i.test(k) ? "[REDACTED]" : redactUnknown(v);
  }
  return out;
}

export function assertAuthorized(scopes: string[] | undefined, requiredScope: string): void {
  if (!scopes || scopes.length === 0) return;
  if (!scopes.includes(requiredScope) && !scopes.includes("admin")) {
    throw new Error(`unauthorized:missing_scope:${requiredScope}`);
  }
}
