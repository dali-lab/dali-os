// The per-slot "role" registry + the saved column-mapping model.
//
// A staffing slot (project-bids, intent-to-work) reconstructs a structured
// "spine" from a bound, fully-flexible form. Instead of guessing structure
// from reference-source heuristics, a manager explicitly maps each form
// question to a slot role and renames its column label; that mapping is saved
// on the binding (StaffingCycleFormBinding.columnMapping) and is the single
// source of truth for interpretation + display.
//
// Pure module (no DB, no HTTP) so it's exhaustively unit-testable, like the
// interpreters that consume it.

import type { Question } from "~/types";
import type { Slot } from "./form-slots";

// A reference question's source family decides whether it can fill a
// project/domain role (the answer must be a real DB id — see
// reference-sources.ts). Kept here as a constraint, not a detector.
const PROJECT_SOURCES = ["projects:open-this-term", "projects:active"];
const DOMAIN_SOURCES = ["domains:active"];

export type QuestionTypeConstraint =
  | "reference-project" // reference question, project source
  | "reference-domain" // reference question, domain source
  | "choice" // select/text answer coerced to a fixed enum (intent status)
  | "text" // free text/textarea
  | "person" // not a question — the authenticated submitter (builtin source)
  | "display" // not staffing-feeding — view-only (builtin or any question)
  | "any";

// Built-in (non-question) column sources. A "person" role can only be filled
// by one of these — never by a form question — so identity is always
// server-derived, never client-supplied. `submitter` resolves to the
// authenticated member at submit time (FormSubmission.userId); the mapping
// entry only carries its display label, never an identity value.
export const BUILTIN_SOURCES = {
  submitter: { defaultLabel: "Submitted by", constraint: "person" as const },
  // The filling member's DomainEligibility (domain + level), resolved
  // server-side at render time. View-only: it informs no staffing write, it's
  // just shown so a manager sees what the member is eligible for.
  hiredRoles: { defaultLabel: "Hired roles", constraint: "display" as const },
} as const;

export type BuiltinSource = keyof typeof BUILTIN_SOURCES;

export function isBuiltinSource(v: unknown): v is BuiltinSource {
  return typeof v === "string" && v in BUILTIN_SOURCES;
}

export type RoleDef = {
  role: string;
  defaultLabel: string;
  // Legacy flag; still read for display purposes. Required-count enforcement
  // lives in `requiredCount` below — leave this `false` and use that instead.
  required: boolean;
  constraint: QuestionTypeConstraint;
  // Intent maps one status question per cycle term, so its role instances are
  // parameterised by termId at mapping time (see SlotColumnMapper).
  perTerm?: boolean;
  // A role the manager may add MORE than one of (the 3 ranked project picks,
  // and their per-bid domain/notes). Repeated entries are paired positionally
  // by the bid interpreter; ordering comes from each entry's `order`.
  repeatable?: boolean;
  // Minimum number of mapped columns this role needs for the slot's mapping
  // to be considered complete (validateMapping enforces, the UI surfaces what
  // is still missing). 0 = optional. For repeatable roles this is the floor,
  // not the ceiling — e.g. project-bids needs 3 ranked `project` columns.
  requiredCount?: number;
};

// Every slot also exposes this role: who submitted the form. Filled by the
// `submitter` builtin (the authenticated member), never a question. Defined
// once and appended to every slot rather than duplicated per slot.
export const SUBMITTER_ROLE: RoleDef = {
  role: "submitter",
  defaultLabel: "Submitted by",
  required: false,
  constraint: "person",
};

// Every slot also exposes a free display column: a question (or the
// hiredRoles builtin) the manager wants visible in the table but which feeds
// no staffing write. This is what makes the view an arbitrary-columns
// database rather than a fixed role list.
export const DISPLAY_ROLE: RoleDef = {
  role: "display",
  defaultLabel: "Column",
  required: false,
  constraint: "display",
  repeatable: true,
};

// View-only column derived server-side from the filling member's
// DomainEligibility (what they could be staffed as). Each slot that wants it
// declares it; project-bids treats it as required so a manager can compare
// bids against eligibility at a glance.
export const HIRED_ROLES_ROLE: RoleDef = {
  role: "hiredRoles",
  defaultLabel: "Hired roles",
  required: false,
  constraint: "display",
};

// The role PALETTE each slot exposes — meanings a column MAY carry, none
// required. A column mapped to project/domain/intent-status feeds staffing;
// anything else (or "display") is view-only. Adding a slot is a registry
// addition here, not a component change.
export const SLOT_ROLES: Record<Slot, RoleDef[]> = {
  "project-bids": [
    {
      role: "project",
      defaultLabel: "Project",
      required: false,
      constraint: "reference-project",
      repeatable: true,
      // The bid spine is three ranked project picks — anything fewer leaves
      // the board with empty slots, so the mapping isn't considered complete
      // until all three are placed. There is no per-bid domain or notes
      // question any more: domain is expanded server-side from the member's
      // DomainEligibility set (one StaffingPreference per project ×
      // eligibility), and free-form text lives on extra display columns.
      requiredCount: 3,
    },
    DISPLAY_ROLE,
    SUBMITTER_ROLE,
    HIRED_ROLES_ROLE,
  ],
  "intent-to-work": [
    {
      role: "intent-status",
      defaultLabel: "Status",
      required: false,
      constraint: "choice",
      perTerm: true,
    },
    DISPLAY_ROLE,
    SUBMITTER_ROLE,
  ],
};

// Builtins a slot must include in its mapping for the configuration to be
// considered complete. Save fails and the board shows a warning until they're
// placed. project-bids needs both `submitter` (who bid) and `hiredRoles`
// (what they can be staffed as) so a manager isn't looking at anonymous rows.
export const REQUIRED_BUILTINS: Record<Slot, BuiltinSource[]> = {
  "project-bids": ["submitter", "hiredRoles"],
  "intent-to-work": [],
};

// A column is filled from one of two source kinds: a form question, or a
// builtin (non-question) value like the authenticated submitter. Legacy
// entries (saved before builtins existed) have no `source` and are read as
// "question" — see parseColumnMapping.
type CommonEntry = {
  role: string;
  label: string;
  // Only for per-term roles (intent-status): which cycle term this entry's
  // answer applies to.
  termId?: string;
  // Position of this column in the table (ascending). Absent on legacy
  // entries — those keep their array order via parseColumnMapping. Repeated
  // roles (project/domain) are paired by this order in the bid interpreter.
  order?: number;
  // Hidden from the default table but still shown on the row's detail page.
  // Absent/false = visible.
  hidden?: boolean;
};

export type ColumnMappingEntry =
  | (CommonEntry & { source: "question"; questionKey: string })
  | (CommonEntry & { source: "builtin"; builtin: BuiltinSource });

export function isQuestionEntry(
  e: ColumnMappingEntry,
): e is CommonEntry & { source: "question"; questionKey: string } {
  return e.source === "question";
}

export type ColumnMapping = {
  version: 1;
  entries: ColumnMappingEntry[];
};

// Roles that older mappings may still carry but the current registry has
// removed. parseColumnMapping silently drops them on load so an existing
// project-bids binding keeps working through the role redesign — the JSON
// stays as it was, but the dropped entries don't render or feed staffing.
const RETIRED_ROLES = new Set(["domain", "notes"]);

// Defensive parse of the Json column — never trust its shape (mirrors the
// safeParse discipline in public-form.ts). Returns null for absent/garbage.
export function parseColumnMapping(json: unknown): ColumnMapping | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.entries)) return null;
  const entries: ColumnMappingEntry[] = [];
  for (let idx = 0; idx < o.entries.length; idx++) {
    const e = o.entries[idx];
    if (!e || typeof e !== "object") return null;
    const r = e as Record<string, unknown>;
    if (typeof r.role !== "string" || typeof r.label !== "string") return null;
    if (RETIRED_ROLES.has(r.role)) continue;
    if (r.termId !== undefined && typeof r.termId !== "string") return null;
    if (r.order !== undefined && typeof r.order !== "number") return null;
    if (r.hidden !== undefined && typeof r.hidden !== "boolean") return null;
    const common = {
      role: r.role,
      label: r.label,
      ...(typeof r.termId === "string" ? { termId: r.termId } : {}),
      // Legacy entries (no `order`) keep their array position so an old
      // mapping renders in the same order it always did.
      order: typeof r.order === "number" ? r.order : idx,
      ...(r.hidden === true ? { hidden: true } : {}),
    };
    // Back-compat: entries saved before builtins have no `source` and are
    // question-sourced. A missing/"question" source needs a questionKey; a
    // "builtin" source needs a recognised builtin name.
    if (r.source === "builtin") {
      if (!isBuiltinSource(r.builtin)) return null;
      entries.push({ ...common, source: "builtin", builtin: r.builtin });
    } else if (r.source === undefined || r.source === "question") {
      if (typeof r.questionKey !== "string") return null;
      entries.push({ ...common, source: "question", questionKey: r.questionKey });
    } else {
      return null; // unknown source discriminant
    }
  }
  return { version: 1, entries };
}

function questionFitsConstraint(
  q: Question,
  constraint: QuestionTypeConstraint,
): boolean {
  switch (constraint) {
    case "any":
    case "display":
      // A display column just shows whatever the question holds — it feeds no
      // staffing write, so any question type fits.
      return true;
    case "text":
      return q.type === "text" || q.type === "textarea";
    case "person":
      // A person role is never satisfiable by a question — only by the
      // `submitter` builtin (checked separately in validateMapping).
      return false;
    case "choice":
      // A fixed-option question (select) or free text we later coerce.
      return q.type === "select" || q.type === "text";
    case "reference-project":
      return (
        q.type === "reference" &&
        !!q.data.referenceSource &&
        PROJECT_SOURCES.includes(q.data.referenceSource)
      );
    case "reference-domain":
      return (
        q.type === "reference" &&
        !!q.data.referenceSource &&
        DOMAIN_SOURCES.includes(q.data.referenceSource)
      );
  }
}

export type MappingCheck = { ok: true } | { ok: false; reason: string };

// Validate a saved mapping against a slot's role set and the form's CURRENT
// question list.
//
// Catches per-entry misconfigurations (unknown role, wrong question
// type/source, stale questionKey from a re-versioned form, two intent-status
// columns fighting over the same term) AND slot-level completeness gaps
// (project-bids needs 3 `project` columns + `submitter` + `hiredRoles`
// builtins). Repeated project/domain/notes/display columns are intentionally
// allowed and paired positionally by the bid interpreter.
export function validateMapping(
  slot: Slot,
  questions: Question[],
  mapping: ColumnMapping | null,
): MappingCheck {
  const roleDefs = SLOT_ROLES[slot];
  const byKey = new Map(questions.map((q) => [q.key, q]));
  // Only per-term roles (intent-status) still reject a duplicate: two status
  // columns for the same term is a real conflict. Repeatable roles don't.
  const seenPerTerm = new Set<string>();

  for (const e of mapping?.entries ?? []) {
    const def = roleDefs.find((d) => d.role === e.role);
    if (!def) {
      return { ok: false, reason: `Unknown column "${e.role}" in mapping.` };
    }
    if (e.source === "builtin") {
      // A builtin entry can't go stale on re-versioning (no questionKey). It
      // just has to exist and match the role's constraint.
      const src = BUILTIN_SOURCES[e.builtin];
      if (!src || src.constraint !== def.constraint) {
        return {
          ok: false,
          reason: `The "${def.defaultLabel}" column can't be filled by that source.`,
        };
      }
    } else {
      const q = byKey.get(e.questionKey);
      if (!q) {
        return {
          ok: false,
          reason:
            "The form was changed and the column mapping is out of date — re-map its questions.",
        };
      }
      if (!questionFitsConstraint(q, def.constraint)) {
        return {
          ok: false,
          reason: `Question "${q.data.label}" can't fill the "${def.defaultLabel}" column (wrong question type).`,
        };
      }
    }
    if (def.perTerm) {
      const dupKey = `${e.role}:${e.termId ?? ""}`;
      if (seenPerTerm.has(dupKey)) {
        return {
          ok: false,
          reason: `The "${def.defaultLabel}" column is mapped more than once for the same term.`,
        };
      }
      seenPerTerm.add(dupKey);
    }
  }

  // Slot-level completeness — required role counts + required builtins must
  // all be present. Reported as one combined "Still need" message so a
  // manager fixes everything in one pass instead of one save at a time.
  const missing = missingRequirements(slot, mapping);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Still need: ${missing.join(", ")}.`,
    };
  }

  return { ok: true };
}

// What's still missing from a slot's mapping for it to be considered
// complete. Returns the role/builtin labels in display order so the UI can
// say e.g. "Still need: Project (2 more), Submitted by, Hired roles". Pure
// on the mapping shape — no DB.
export function missingRequirements(
  slot: Slot,
  mapping: ColumnMapping | null,
): string[] {
  const missing: string[] = [];
  const entries = mapping?.entries ?? [];

  for (const def of SLOT_ROLES[slot]) {
    const need = def.requiredCount ?? 0;
    if (need === 0) continue;
    const have = entries.filter((e) => e.role === def.role).length;
    if (have >= need) continue;
    missing.push(
      need > 1
        ? `${def.defaultLabel} (${need - have} more)`
        : def.defaultLabel,
    );
  }

  const placed = new Set(
    entries.filter((e) => e.source === "builtin").map((e) => e.builtin),
  );
  for (const name of REQUIRED_BUILTINS[slot]) {
    if (!placed.has(name)) missing.push(BUILTIN_SOURCES[name].defaultLabel);
  }

  return missing;
}

// Label a structured role currently has in this mapping (for display
// headers), falling back to the role's default.
export function roleLabel(
  slot: Slot,
  mapping: ColumnMapping | null,
  role: string,
  termId?: string,
): string {
  const fromMap = mapping?.entries.find(
    (e) => e.role === role && (termId === undefined || e.termId === termId),
  );
  if (fromMap) return fromMap.label;
  return SLOT_ROLES[slot].find((d) => d.role === role)?.defaultLabel ?? role;
}
