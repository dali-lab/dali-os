// Turn a bound form's answers into per-term Intent-to-Work rows, using the
// binding's saved column mapping. Symmetric with bid-form-interpreter.ts but
// the spine is different: one IntentToWork row per (cycle term), each a
// status enum, not project/domain.
//
// The mapping has one `intent-status` entry per cycle term (entry.termId set).
// Each entry's mapped question answer is coerced to an IntentStatus. Pure
// (no DB/HTTP) so it's exhaustively unit-testable.

import type { ColumnMapping } from "./slot-roles";
import { INTENT_STATUSES, type IntentStatusValue } from "./intent-status";

export type { IntentStatusValue };

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

function coerceStatus(v: unknown, statusMap?: Record<string, IntentStatusValue>): IntentStatusValue | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  const mapped =
    statusMap?.[v] ?? Object.entries(statusMap ?? {}).find(([answer]) => answer.trim() === trimmed)?.[1];
  if (mapped) return mapped;
  if ((INTENT_STATUSES as string[]).includes(trimmed)) return trimmed as IntentStatusValue;
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
//
// `cycleTermId` is the bound cycle's OWN term, which fills a status entry that
// names no term ("this cycle's term" in the mapper). That's what lets one form
// be re-bound round after round: the mapping follows the form and the rows
// land on whichever term the new cycle is for, with no re-mapping.
export function interpretIntentForm(
  answers: Record<string, unknown>,
  mapping: ColumnMapping,
  cycleTermIds: string[],
  cycleTermId?: string | null,
): IntentInterpretResult {
  const termSet = new Set(cycleTermIds);
  const rows: RawIntent[] = [];

  for (const e of mapping.entries) {
    // Builtin columns (e.g. the submitter) carry no answer; the submitter is
    // keyed from the session in public-form.ts, not from the mapping.
    if (e.source === "builtin") continue;
    if (e.role !== "intent-status") continue;
    const termId = e.termId ?? cycleTermId;
    if (!termId) {
      return {
        ok: false,
        error: "Intent mapping is missing a term for one of its status columns.",
      };
    }
    // A cycle-term entry is correct by construction (it IS this cycle's
    // term), so only an explicitly named term is checked for staleness.
    if (e.termId && !termSet.has(e.termId)) {
      return {
        ok: false,
        error:
          "The intent form's column mapping is out of date for this cycle's terms — re-map it.",
      };
    }
    const raw = answers[e.questionKey];
    // An unanswered optional term is simply skipped (no row written).
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) continue;
    const status = coerceStatus(raw, e.statusMap);
    if (!status) {
      return {
        ok: false,
        error: `"${String(raw)}" isn't a valid availability status.`,
      };
    }
    rows.push({ termId, status });
  }

  // No rows is NOT an error any more: the raw submission is still recorded by
  // the caller regardless, this just produces no IntentToWork rows. Genuine
  // misconfigurations (bad status value, stale term) above still fail so a
  // manager fixes them.
  return { ok: true, rows };
}

export type IntentResyncPlan = {
  sets: { userId: string; rows: RawIntent[] }[];
  failed: number;
};

// Saving or changing the mapping re-reads every submission already in the
// cycle, so responses that came in before the status question was mapped
// still count.
export function planIntentResync(
  submissions: { userId: string; answers: unknown }[],
  mapping: ColumnMapping,
  cycleTermIds: string[],
  cycleTermId: string | null,
): IntentResyncPlan {
  const sets: IntentResyncPlan["sets"] = [];
  let failed = 0;
  for (const s of submissions) {
    const answers = s.answers && typeof s.answers === "object" ? (s.answers as Record<string, unknown>) : {};
    const result = interpretIntentForm(answers, mapping, cycleTermIds, cycleTermId);
    if (result.ok) sets.push({ userId: s.userId, rows: result.rows });
    else failed += 1;
  }
  return { sets, failed };
}

// Prefills the answer-to-status picker: options that already read as a
// status (by name or a known label) start mapped, the rest start blank.
export function defaultStatusMap(options: string[]): Record<string, IntentStatusValue> {
  const out: Record<string, IntentStatusValue> = {};
  for (const o of options) {
    const s = coerceStatus(o);
    if (s) out[o] = s;
  }
  return out;
}
