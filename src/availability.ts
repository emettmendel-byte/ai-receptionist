import fs from "node:fs";
import path from "node:path";

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

/** Read-only stub: primary + alternate slots from clinic JSON (Sully-style “best + alternatives”). */
export function getSlotSuggestions(input: { whenHint?: string }): SlotSuggestions {
  const c = loadClinicConfig();
  const primary =
    input.whenHint?.trim() ||
    c.primary_slot_hint ||
    "Thu 10:30am ET (CCM telehealth)";
  const alternates =
    c.alternate_slots?.length ? [...c.alternate_slots] : ["Fri 2:00pm ET", "Mon 9:00am ET"];
  const visit_types = c.visit_types?.length ? c.visit_types : ["CCM", "RPM"];
  return {
    primary,
    alternates,
    visit_types,
    note: `_Prototype: rules from \`${path.basename(clinicHoursPath())}\`; no live calendar._`,
  };
}
