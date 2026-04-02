import { DateTime } from "luxon";
import type { ClinicConfig } from "./availability.js";
import { loadClinicConfig } from "./availability.js";
import { normalizeSlotLabel } from "./appointments.js";

export type CalendarSlot = {
  /** Stable id stored in SQLite (ISO with offset). */
  key: string;
  /** Human-readable line for Slack. */
  label: string;
};

function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map((x) => Number(x));
  return { h: h || 0, m: m || 0 };
}

/**
 * Fake calendar: next `daysAhead` local days, clinic blocks + slot length, minus booked keys.
 */
export function listOpenCalendarSlots(input: {
  bookedSlotLabels: Set<string>;
  daysAhead?: number;
  clinic?: ClinicConfig;
  now?: DateTime;
}): CalendarSlot[] {
  const clinic = input.clinic ?? loadClinicConfig();
  const tz = clinic.timezone || "America/New_York";
  const lengthMin = clinic.slot_length_minutes ?? 30;
  const blocks = clinic.blocks ?? [];
  const daysAhead = input.daysAhead ?? 7;
  const booked = input.bookedSlotLabels;
  const out: CalendarSlot[] = [];

  let dayCursor = (input.now ?? DateTime.now().setZone(tz)).startOf("day");
  const endExclusive = dayCursor.plus({ days: daysAhead });

  while (dayCursor < endExclusive) {
    const wd = dayCursor.weekday;
    for (const b of blocks) {
      if (b.weekday !== wd) continue;
      const st = parseHHMM(b.start);
      const et = parseHHMM(b.end);
      let t = dayCursor.set({ hour: st.h, minute: st.m, second: 0, millisecond: 0 });
      const endT = dayCursor.set({ hour: et.h, minute: et.m, second: 0, millisecond: 0 });
      while (t < endT) {
        if (t <= DateTime.now().setZone(tz).plus({ minutes: 1 })) {
          t = t.plus({ minutes: lengthMin });
          continue;
        }
        const key = t.toISO({ suppressMilliseconds: true })!;
        const label = t.toFormat("ccc LLL d, yyyy • h:mm a ZZZZ");
        const k1 = normalizeSlotLabel(key);
        const k2 = normalizeSlotLabel(label);
        if (!booked.has(k1) && !booked.has(k2)) {
          out.push({ key, label });
        }
        t = t.plus({ minutes: lengthMin });
      }
    }
    dayCursor = dayCursor.plus({ days: 1 });
  }

  return out;
}

export function formatSlotsForSlack(slots: CalendarSlot[], max = 6): string {
  if (slots.length === 0) return "_No open slots in the demo calendar window — cancel/reschedule to free one._";
  const lines = slots.slice(0, max).map((s) => `• ${s.label}`);
  const more =
    slots.length > max
      ? `\n_…and ${slots.length - max} more in the next week (name a day or time to narrow)._`
      : "";
  return `${lines.join("\n")}${more}`;
}

/** Match user text / entity when to a concrete open slot (booking). */
export function pickOpenSlotForBooking(
  text: string,
  whenEntity: string | undefined,
  open: CalendarSlot[],
): CalendarSlot | null {
  const hay = `${text} ${whenEntity ?? ""}`.toLowerCase();
  if (!open.length) return null;

  // Exact key pasted from bot (`slot:2026-04-07T10` prefix)
  const keyMatch = text.match(
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/,
  );
  if (keyMatch) {
    const found = open.find((s) => s.key.startsWith(keyMatch[1].split(".")[0]) || s.key === keyMatch[1]);
    if (found) return found;
    const foundNorm = open.find((s) => normalizeSlotLabel(s.key) === normalizeSlotLabel(keyMatch[1]));
    if (foundNorm) return foundNorm;
  }

  // Label substring match (user copies "Mon Apr 7, 2026 • 10:30 AM")
  for (const s of open) {
    const frag = s.label.replace(/\s+/g, " ").toLowerCase();
    if (frag.length > 12 && hay.includes(frag.slice(0, 24))) return s;
  }

  // Weekday names
  const days: [RegExp, number][] = [
    [/\bmon(day)?s?\b/i, 1],
    [/\btue(s|day)?s?\b/i, 2],
    [/\bwed(nesday)?s?\b/i, 3],
    [/\bthursday\b|\bthu(r(s|day)?)?s?\b/i, 4],
    [/\bfri(day)?s?\b/i, 5],
    [/\bsat(urday)?s?\b/i, 6],
    [/\bsun(day)?s?\b/i, 7],
  ];
  const tz = loadClinicConfig().timezone || "America/New_York";
  const hourHint = (() => {
    if (/\b1\s*:?\s*00?\s*pm\b|\b1\s*pm\b/i.test(hay)) return 13;
    if (/\b2\s*:?\s*00?\s*pm\b|\b2\s*pm\b/i.test(hay)) return 14;
    if (/\b3\s*:?\s*00?\s*pm\b|\b3\s*pm\b/i.test(hay)) return 15;
    if (/\b9\s*:?\s*00?\s*am\b|\b9\s*am\b/i.test(hay)) return 9;
    if (/\b10\s*:?\s*00?\s*am\b|\b10\s*am\b/i.test(hay)) return 10;
    if (/\b11\s*:?\s*00?\s*am\b|\b11\s*am\b/i.test(hay)) return 11;
    return undefined;
  })();

  for (const [re, w] of days) {
    if (re.test(hay)) {
      let candidates = open.filter((s) => DateTime.fromISO(s.key).setZone(tz).weekday === w);
      if (hourHint !== undefined) {
        const narrowed = candidates.filter((s) => DateTime.fromISO(s.key).setZone(tz).hour === hourHint);
        if (narrowed.length) candidates = narrowed;
      }
      if (candidates.length) return candidates[0];
    }
  }

  // "morning" / "afternoon"
  if (/\bmorning\b/i.test(hay)) {
    const hit = open.find((s) => {
      const h = DateTime.fromISO(s.key).hour;
      return h >= 9 && h < 12;
    });
    if (hit) return hit;
  }
  if (/\bafternoon\b/i.test(hay)) {
    const hit = open.find((s) => {
      const h = DateTime.fromISO(s.key).hour;
      return h >= 12 && h < 17;
    });
    if (hit) return hit;
  }

  return null;
}

/** Pick a free slot for reschedule target (e.g. "Monday"). */
export function pickOpenSlotForRescheduleHint(hint: string, open: CalendarSlot[]): CalendarSlot | null {
  return pickOpenSlotForBooking(hint, undefined, open);
}
