import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAudit } from "../src/auditLog.js";
import { closeDb, getDb } from "../src/db.js";

describe("auditLog", () => {
  let dir: string;

  beforeEach(() => {
    closeDb();
    dir = mkdtempSync(path.join(tmpdir(), "gh-audit-"));
    process.env.DATA_DIR = dir;
  });

  afterEach(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("appendAudit inserts a row into audit_log", () => {
    getDb();
    appendAudit({
      session_key: "U1:1.1",
      user_id: "U1",
      intent: "faq",
      confidence: 0.9,
      path: "automated",
      phi_flag: false,
      action_summary: "test",
      text_preview: "hello world",
    });
    const row = getDb()
      .prepare(`SELECT intent, phi_flag FROM audit_log ORDER BY id DESC LIMIT 1`)
      .get() as { intent: string; phi_flag: number };
    expect(row.intent).toBe("faq");
    expect(row.phi_flag).toBe(0);
  });
});
