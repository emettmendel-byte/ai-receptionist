import fs from "node:fs";
import path from "node:path";
import { normalizeSlotLabel } from "./appointments.js";

export type ClinicConfig = {
  timezone?: string;
  visit_types?: string[];
  blocks?: { weekday: number; start: string; end: string; label?: string }[];
  slot_length_minutes?: number;
  primary_slot_hint?: string;
  alternate_slots?: string[];
};

let cached: ClinicConfig | null = null;
let cachedPath = "";

function clinicHoursPath(): string {
  return (
    process.env.CLINIC_HOURS_PATH ??
    path.join(process.cwd(), "config", "clinic-hours.sample.json")
  );
}

export function loadClinicConfig(): ClinicConfig {
  const p = clinicHoursPath();
  if (cached && cachedPath === p) return cached;
  try {
    const raw = fs.readFileSync(p, "utf8");
    cached = JSON.parse(raw) as ClinicConfig;
    cachedPath = p;
  } catch {
    cached = {
      primary_slot_hint: "Next available telehealth (stub)",
      alternate_slots: ["T+1 10:30am", "T+2 2:00pm"],
    };
    cachedPath = p;
  }
  return cached!;
}

export type SlotSuggestions = {
  primary: string;
  alternates: string[];
  visit_types: string[];
  note: string;
};

/** Ordered candidates: user hint first, then config primary, then alternates (deduped by normalized label). */
export function buildSlotCandidates(whenHint?: string): string[] {
  const c = loadClinicConfig();
  const hint = whenHint?.trim();
  const primary =
    hint || c.primary_slot_hint || "Thu 10:30am ET (CCM telehealth)";
  const alternates =
    c.alternate_slots?.length ? [...c.alternate_slots] : ["Fri 2:00pm ET", "Mon 9:00am ET"];
  const ordered = [primary, ...alternates];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of ordered) {
    const k = normalizeSlotLabel(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s.trim());
  }
  return out;
}

/**
 * Primary + alternates from clinic JSON; skips slots already booked (normalized match).
 * When `bookedSlots` is omitted, no filtering (backward compatible for tests).
 */
export function getSlotSuggestions(input: {
  whenHint?: string;
  bookedSlots?: Set<string>;
}): SlotSuggestions {
  const c = loadClinicConfig();
  const candidates = buildSlotCandidates(input.whenHint);
  const booked = input.bookedSlots ?? new Set<string>();

  const free = candidates.filter((s) => !booked.has(normalizeSlotLabel(s)));
  const visit_types = c.visit_types?.length ? c.visit_types : ["CCM", "RPM"];

  if (free.length === 0) {
    return {
      primary: "",
      alternates: [],
      visit_types,
      note:
        `_Prototype: no open template slots — all are booked in the local ledger._ See \`${path.basename(clinicHoursPath())}\`.`,
    };
  }

  return {
    primary: free[0],
    alternates: free.slice(1),
    visit_types,
    note: `_Prototype: open slots exclude times already booked in SQLite._ Config: \`${path.basename(clinicHoursPath())}\`.`,
  };
}
