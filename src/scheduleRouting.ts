/**
 * Deterministic routing hints so NLU mistakes don’t book or skip reschedule.
 */
import type { CalendarSlot } from "./calendarSlots.js";

/** User is asking *when* they could book / what’s open — do not commit a booking. */
export function isAvailabilityOnlyQuestion(text: string): boolean {
  return (
    /\bwhen\s+(can|could|should)\s+(i|you|we)\s+.*\b(book|schedule|get)\b/i.test(text) ||
    /\bwhen\s+(can|could|should)\s+i\s+(book|schedule|get|come\s+in)|\bhow\s+soon\s+(can|could)\s+i\s+book\b/i.test(
      text,
    ) ||
    /\bwhat(\s+('|’)?s)?\s+available\b|\bavailable\s+(times|slots|openings)\b|\b(openings?|open\s+slots)\b/i.test(
      text,
    ) ||
    /\bwhat\s+times\b|\bshow\s+(me\s+)?(available\s+)?(times|slots|calendar)\b/i.test(text) ||
    /\bdo\s+you\s+have\s+(any\s+)?(open|available)/i.test(text) ||
    /\b(list|see)\s+(the\s+)?(open|available)\s+(slots|times)\b/i.test(text) ||
    /\bany\s+(free|open)\s+(slots|times|appointments)\b/i.test(text)
  );
}

/** User is trying to *commit* a visit (book / reserve / hold). */
export function isExplicitBookingRequest(text: string): boolean {
  if (isAvailabilityOnlyQuestion(text)) return false;
  return (
    /\b(book|reserve)\s+(a|an|the|me|my|us)\b/i.test(text) ||
    /\b(book|reserve)\s+for\b/i.test(text) ||
    /\bschedule\s+(a|an|the|me|my|us)\b/i.test(text) ||
    /\bput\s+me\s+down\s+for\b/i.test(text) ||
    /\bconfirm\s+(the\s+)?(slot|time|appointment)\b/i.test(text) ||
    /\bi\s+need\s+to\s+book\b/i.test(text) ||
    /\bmake\s+(a|an)\s+appointment\b/i.test(text) ||
    /\b(patient|we|they)\s+needs?\s+(a|an)\b.*\b(slot|visit|appointment)\b/i.test(text) ||
    /\bget\s+(a|an|the)\s+.*\b(slot|appointment)\b/i.test(text)
  );
}

export function isAppointmentChangeRequest(text: string): boolean {
  return (
    /\breschedul(e|ing)?\b/i.test(text) ||
    /\bcancel(lation|ling)?\b/i.test(text) ||
    /\bwait\s*list\b|\bwaitlist\b/i.test(text) ||
    /\bmove\s+my\s+appointment\b/i.test(text)
  );
}

/** Book only with clear intent, pasted ISO, or a long copied label match — not vague “Tuesday”. */
export function shouldCommitBooking(text: string, picked: CalendarSlot | null): boolean {
  if (isExplicitBookingRequest(text)) return true;
  if (!picked) return false;
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return true;
  const frag = picked.label.replace(/\s+/g, " ").toLowerCase();
  return frag.length >= 24 && text.toLowerCase().includes(frag.slice(0, 24));
}

import type { Classification } from "./types.js";

/** Fix common Ollama misroutes before routing. */
export function patchSchedulingClassification(text: string, c: Classification): Classification {
  if (isAppointmentChangeRequest(text)) {
    return {
      ...c,
      intent: "appointment_change",
      confidence: Math.max(c.confidence, 0.92),
      rationale: `${c.rationale ?? ""} [patched: appointment change]`.trim(),
    };
  }
  /** NLU often labels “book me Thursday…” as availability — force real booking path. */
  if (isExplicitBookingRequest(text)) {
    return {
      ...c,
      intent: "schedule_inquiry",
      confidence: Math.max(c.confidence, 0.93),
      rationale: `${c.rationale ?? ""} [patched: explicit booking]`.trim(),
    };
  }
  if (isAvailabilityOnlyQuestion(text)) {
    return {
      ...c,
      intent: "availability_inquiry",
      confidence: Math.max(c.confidence, 0.95),
      rationale: `${c.rationale ?? ""} [patched: availability question]`.trim(),
    };
  }
  return c;
}
