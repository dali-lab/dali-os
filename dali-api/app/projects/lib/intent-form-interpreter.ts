// Turn a bound form's answers into per-term Intent-to-Work rows, using the
// binding's saved column mapping. Symmetric with bid-form-interpreter.ts but
// the spine is different: one IntentToWork row per (cycle term), each a
// status enum, not project/domain.
//
// The mapping has one `intent-status` entry per cycle term (entry.termId set).
// Each entry's mapped question answer is coerced to an IntentStatus. Pure
// (no DB/HTTP) so it's exhaustively unit-testable.

import type { ColumnMapping } from "./slot-roles";

export type IntentStatusValue =
  | "Returning"
  | "Off"
  | "Graduating"
  | "Leave"
  | "Unsure";

const STATUSES: IntentStatusValue[] = [
  "Returning",
  "Off",
  "Graduating",
  "Leave",
  "Unsure",
];

// Accepts the canonical enum value, or a few human option labels a flexible
// form might use, mapped onto the enum. Anything else is rejected (the form
// is misconfigured) rather than silently coerced.
const LABEL_ALIASES: Record<string, IntentStatusValue> = {
  returning: "Returning",
  "not this term": "Off",
  off: "Off",
  "off-term": "Off",
  graduating: "Graduating",
  "on leave": "Leave",
  leave: "Leave",
  unsure: "Unsure",
};

function coerceStatus(v: unknown): IntentStatusValue | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if ((STATUSES as string[]).includes(trimmed)) return trimmed as IntentStatusValue;
  return LABEL_ALIASES[trimmed.toLowerCase()] ?? null;
}

export type RawIntent = { termId: string; status: IntentStatusValue };

export type IntentInterpretResult =
  | { ok: true; rows: RawIntent[] }
  | { ok: false; error: string };

// `cycleTermIds` = the terms the cycle actually covers; an entry pointing at
// a term outside that set is a stale/misconfigured mapping. Mapping validity
// (required role, question type) is the caller's job via validateMapping();
// this assembles rows + enforces the status enum + term membership.
export function interpretIntentForm(
  answers: Record<string, unknown>,
  mapping: ColumnMapping,
  cycleTermIds: string[],
): IntentInterpretResult {
  const termSet = new Set(cycleTermIds);
  const rows: RawIntent[] = [];

  for (const e of mapping.entries) {
    // Builtin columns (e.g. the submitter) carry no answer; the submitter is
    // keyed from the session in public-form.ts, not from the mapping.
    if (e.source === "builtin") continue;
    if (e.role !== "intent-status") continue;
    if (!e.termId) {
      return {
        ok: false,
        error: "Intent mapping is missing a term for one of its status columns.",
      };
    }
    if (!termSet.has(e.termId)) {
      return {
        ok: false,
        error:
          "The intent form's column mapping is out of date for this cycle's terms — re-map it.",
      };
    }
    const raw = answers[e.questionKey];
    // An unanswered optional term is simply skipped (no row written).
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) continue;
    const status = coerceStatus(raw);
    if (!status) {
      return {
        ok: false,
        error: `"${String(raw)}" isn't a valid availability status.`,
      };
    }
    rows.push({ termId: e.termId, status });
  }

  if (rows.length === 0) {
    return { ok: false, error: "No availability was submitted." };
  }
  return { ok: true, rows };
}
