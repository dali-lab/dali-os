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
  | "any";

// Built-in (non-question) column sources. A "person" role can only be filled
// by one of these — never by a form question — so identity is always
// server-derived, never client-supplied. `submitter` resolves to the
// authenticated member at submit time (FormSubmission.userId); the mapping
// entry only carries its display label, never an identity value.
export const BUILTIN_SOURCES = {
  submitter: { defaultLabel: "Submitted by", constraint: "person" as const },
} as const;

export type BuiltinSource = keyof typeof BUILTIN_SOURCES;

export function isBuiltinSource(v: unknown): v is BuiltinSource {
  return typeof v === "string" && v in BUILTIN_SOURCES;
}

export type RoleDef = {
  role: string;
  defaultLabel: string;
  required: boolean;
  constraint: QuestionTypeConstraint;
  // Intent maps one status question per cycle term, so its role instances are
  // parameterised by termId at mapping time (see SlotColumnMapper).
  perTerm?: boolean;
};

// Every slot also exposes this role: who submitted the form. It's filled by
// the `submitter` builtin (the authenticated member), never a question, and
// is optional so legacy mappings stay valid. Defined once and appended to
// every slot rather than duplicated per slot.
export const SUBMITTER_ROLE: RoleDef = {
  role: "submitter",
  defaultLabel: "Submitted by",
  required: false,
  constraint: "person",
};

// The role set each slot exposes. Adding a slot (e.g. applications later) is a
// registry addition here, not a component change. Every slot gets the shared
// SUBMITTER_ROLE appended.
export const SLOT_ROLES: Record<Slot, RoleDef[]> = {
  "project-bids": [
    {
      role: "project",
      defaultLabel: "Project",
      required: true,
      constraint: "reference-project",
    },
    {
      role: "domain",
      defaultLabel: "Domain",
      required: true,
      constraint: "reference-domain",
    },
    {
      role: "notes",
      defaultLabel: "Notes",
      required: false,
      constraint: "text",
    },
    SUBMITTER_ROLE,
  ],
  "intent-to-work": [
    {
      role: "intent-status",
      defaultLabel: "Status",
      required: true,
      constraint: "choice",
      perTerm: true,
    },
    SUBMITTER_ROLE,
  ],
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

// Defensive parse of the Json column — never trust its shape (mirrors the
// safeParse discipline in public-form.ts). Returns null for absent/garbage.
export function parseColumnMapping(json: unknown): ColumnMapping | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.entries)) return null;
  const entries: ColumnMappingEntry[] = [];
  for (const e of o.entries) {
    if (!e || typeof e !== "object") return null;
    const r = e as Record<string, unknown>;
    if (typeof r.role !== "string" || typeof r.label !== "string") return null;
    if (r.termId !== undefined && typeof r.termId !== "string") return null;
    const common = {
      role: r.role,
      label: r.label,
      ...(typeof r.termId === "string" ? { termId: r.termId } : {}),
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
// question list. Catches: required role unmapped, a role's question of the
// wrong type/source, an entry pointing at a since-deleted question (the form
// was re-versioned), a duplicate (role[,termId]) assignment.
export function validateMapping(
  slot: Slot,
  questions: Question[],
  mapping: ColumnMapping | null,
): MappingCheck {
  if (!mapping || mapping.entries.length === 0) {
    return {
      ok: false,
      reason:
        "No column mapping is set up for this form yet — map its questions to columns.",
    };
  }
  const roleDefs = SLOT_ROLES[slot];
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const seen = new Set<string>();

  for (const e of mapping.entries) {
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
    const dupKey = def.perTerm ? `${e.role}:${e.termId ?? ""}` : e.role;
    if (!def.perTerm && seen.has(dupKey)) {
      return {
        ok: false,
        reason: `The "${def.defaultLabel}" column is mapped more than once.`,
      };
    }
    seen.add(dupKey);
  }

  // Every required, non-per-term role must be mapped at least once. Per-term
  // roles are validated by the caller against the cycle's actual terms.
  for (const def of roleDefs) {
    if (!def.required || def.perTerm) continue;
    if (!mapping.entries.some((e) => e.role === def.role)) {
      return {
        ok: false,
        reason: `The required "${def.defaultLabel}" column isn't mapped to any question.`,
      };
    }
  }
  return { ok: true };
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
