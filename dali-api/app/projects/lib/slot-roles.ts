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

import { isIntentStatus, type IntentStatusValue } from "./intent-status";
import type { Question } from "~/types";
import { conditionalKeys } from "~/forms/lib/form-logic";
import type { Slot } from "./form-slots";
import { placeholder } from "~/lib/template-variables";
import { defaultStatusMap } from "./intent-form-interpreter";
import { moveAmongVisible, type ColumnOp } from "~/forms/lib/column-ops";
import { columnKey } from "./submission-columns";

// `QuestionTypeConstraint` still declares each role's intended shape (and
// drives the `person` identity boundary), but mapping a question to a role no
// longer enforces the question's type — see questionFitsConstraint.
export type QuestionTypeConstraint =
  | "reference-project" // reference question, project source
  | "reference-domain" // reference question, domain source
  | "choice" // select/radio/text answer coerced to a fixed enum (intent status)
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
  projectHistory: { defaultLabel: "Project history", constraint: "display" as const },
  termsInLab: { defaultLabel: "Terms in lab", constraint: "display" as const },
  currentRole: { defaultLabel: "Current role", constraint: "display" as const },
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

const HISTORY_ROLES: RoleDef[] = (
  ["projectHistory", "termsInLab", "currentRole"] as const
).map((role) => ({
  role,
  defaultLabel: BUILTIN_SOURCES[role].defaultLabel,
  required: false,
  constraint: "display",
}));

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
    ...HISTORY_ROLES,
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
    HIRED_ROLES_ROLE,
    ...HISTORY_ROLES,
  ],
  "level-up": [
    {
      role: "target-domain",
      defaultLabel: "Applying In",
      required: false,
      // Accepts any question type: a reference-domain question yields a domain
      // ID as the raw answer; a choice/text question yields a display name
      // string. The Level Up action resolves both (ID lookup first, then
      // displayName match).
      constraint: "any",
      requiredCount: 1,
    },
    {
      role: "target-level",
      defaultLabel: "Applying For",
      required: false,
      constraint: "choice",
      requiredCount: 1,
    },
    DISPLAY_ROLE,
    SUBMITTER_ROLE,
    HIRED_ROLES_ROLE,
    ...HISTORY_ROLES,
  ],
};

// Builtins a slot must include in its mapping for the configuration to be
// considered complete. Save fails and the board shows a warning until they're
// placed. project-bids needs both `submitter` (who bid) and `hiredRoles`
// (what they can be staffed as) so a manager isn't looking at anonymous rows.
export const REQUIRED_BUILTINS: Record<Slot, BuiltinSource[]> = {
  "project-bids": ["submitter", "hiredRoles"],
  "intent-to-work": [],
  "level-up": ["submitter"],
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
  // Only for intent-status: which status each answer option means, e.g.
  // { "Yes": "Returning" }. Answers not listed fall back to the status names.
  statusMap?: Record<string, IntentStatusValue>;
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
      ...parseStatusMap(r.statusMap),
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

function parseStatusMap(raw: unknown): { statusMap?: Record<string, IntentStatusValue> } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, IntentStatusValue> = {};
  for (const [answer, status] of Object.entries(raw as Record<string, unknown>)) {
    if (isIntentStatus(status)) out[answer] = status;
  }
  return Object.keys(out).length > 0 ? { statusMap: out } : {};
}

function questionFitsConstraint(
  _q: Question,
  constraint: QuestionTypeConstraint,
): boolean {
  // Question-type constraints are intentionally NOT enforced: a manager may
  // map any question to any role. The interpreters degrade gracefully when an
  // answer doesn't match the role's expected shape — e.g. the bid interpreter
  // coerces the `project` answer to an id and simply skips it when it isn't a
  // real project id (bid-form-interpreter.ts), rather than erroring. So a
  // mismatched type produces no staffing write, never a save failure.
  //
  // `person` is the one exception, and it isn't a question-type rule: a person
  // role can only be filled by the `submitter` builtin (server-derived
  // identity), never by a client-supplied question answer. Keeping it
  // unsatisfiable-by-question preserves that identity boundary.
  return constraint !== "person";
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
  const problem = mappingEntryProblem(slot, questions, mapping);
  if (problem) return { ok: false, reason: problem };

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

// The first entry the slot can't use, ignoring whether required roles are
// all placed yet. Column edits from the board's table check only this, so a
// half-mapped board can still change columns.
export function mappingEntryProblem(
  slot: Slot,
  questions: Question[],
  mapping: ColumnMapping | null,
): string | null {
  const roleDefs = SLOT_ROLES[slot];
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const conditional = conditionalKeys(questions);
  // Only per-term roles (intent-status) still reject a duplicate: two status
  // columns for the same term is a real conflict. Repeatable roles don't.
  const seenPerTerm = new Set<string>();

  for (const e of mapping?.entries ?? []) {
    const def = roleDefs.find((d) => d.role === e.role);
    if (!def) {
      return `Unknown column "${e.role}" in mapping.`;
    }
    if (e.source === "builtin") {
      // A builtin entry can't go stale on re-versioning (no questionKey). It
      // just has to exist and match the role's constraint.
      const src = BUILTIN_SOURCES[e.builtin];
      if (!src || src.constraint !== def.constraint) {
        return `The "${def.defaultLabel}" column can't be filled by that source.`;
      }
    } else {
      const q = byKey.get(e.questionKey);
      if (!q) {
        return "The form was changed and the column mapping is out of date — re-map its questions.";
      }
      if (conditional.has(q.key)) {
        return `Question "${q.data.label}" is only shown sometimes, so it can't fill the "${def.defaultLabel}" column.`;
      }
      if (!questionFitsConstraint(q, def.constraint)) {
        return `Question "${q.data.label}" can't fill the "${def.defaultLabel}" column (wrong question type).`;
      }
    }
    if (def.perTerm) {
      const dupKey = `${e.role}:${e.termId ?? ""}`;
      if (seenPerTerm.has(dupKey)) {
        return `The "${def.defaultLabel}" column is mapped more than once for the same term.`;
      }
      seenPerTerm.add(dupKey);
    }
  }

  return null;
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

// Builtins a manager can add to or remove from a board's table with the
// header's + button and column menu.
export const BOARD_COLUMN_BUILTINS = [
  "hiredRoles",
  "projectHistory",
  "termsInLab",
  "currentRole",
] as const satisfies readonly BuiltinSource[];

export type BoardColumnBuiltin = (typeof BOARD_COLUMN_BUILTINS)[number];

export function isBoardColumnBuiltin(v: unknown): v is BoardColumnBuiltin {
  return (BOARD_COLUMN_BUILTINS as readonly unknown[]).includes(v);
}

// Show a builtin column at the end of the table: unhide it when the mapping
// already has it, else append a new entry.
export function showBuiltinColumn(
  mapping: ColumnMapping | null,
  builtin: BoardColumnBuiltin,
): ColumnMapping {
  const entries = mapping?.entries ?? [];
  const lastOrder = Math.max(-1, ...entries.map((e) => e.order ?? 0));
  const existing = entries.some((e) => e.source === "builtin" && e.builtin === builtin);
  return {
    version: 1,
    entries: existing
      ? entries.map((e) =>
          e.source === "builtin" && e.builtin === builtin
            ? { ...e, hidden: false, order: lastOrder + 1 }
            : e,
        )
      : [
          ...entries,
          {
            role: builtin,
            label: BUILTIN_SOURCES[builtin].defaultLabel,
            source: "builtin",
            builtin,
            order: lastOrder + 1,
          },
        ],
  };
}


// A role column's starting label: repeatable roles count up ("Project 2"),
// per-term roles name the term ("Status — 27W", or the {{term}} token for
// the bound cycle's own term).
export function roleColumnLabel(
  def: RoleDef,
  positionAmongRole: number,
  termCode?: string,
): string {
  if (def.perTerm && termCode) return `${def.defaultLabel} — ${termCode}`;
  if (def.repeatable) return `${def.defaultLabel} ${positionAmongRole + 1}`;
  return def.defaultLabel;
}

// Roles a question column can feed on this slot, besides plain display.
export function questionRoles(slot: Slot): RoleDef[] {
  return SLOT_ROLES[slot].filter(
    (d) => d.constraint !== "person" && d.constraint !== "display",
  );
}

export type RoleChoice = { value: string; label: string };

// The "Feeds staffing as" menu for a question column. A per-term role is one
// choice per term plus one for the bound cycle's own term; the value carries
// the term as "role@termId" ("role@" for the cycle's term).
export function questionRoleChoices(
  slot: Slot,
  terms: readonly { id: string; code: string }[],
): RoleChoice[] {
  const out: RoleChoice[] = [{ value: "display", label: "Nothing, just show it" }];
  for (const def of questionRoles(slot)) {
    if (!def.perTerm) {
      out.push({ value: def.role, label: def.defaultLabel });
      continue;
    }
    out.push({ value: `${def.role}@`, label: `${def.defaultLabel} for this cycle's term` });
    for (const t of terms) out.push({ value: `${def.role}@${t.id}`, label: `${def.defaultLabel} for ${t.code}` });
  }
  return out;
}

export function roleChoiceValue(e: { role: string; termId?: string }, slot: Slot): string {
  const def = SLOT_ROLES[slot].find((d) => d.role === e.role);
  return def?.perTerm ? `${e.role}@${e.termId ?? ""}` : e.role;
}

export function parseRoleChoice(value: string): { role: string; termId: string | null } {
  const [role, termId] = value.split("@");
  return { role, termId: termId || null };
}


// One column change from a board's table, applied to its mapping. Ids are the
// table's column keys ("q:<key>", "builtin:<name>", "@<termId>" for per-term
// columns). Returns the reason when the change can't apply.
export function applyBoardColumnOp(
  mapping: ColumnMapping | null,
  op: ColumnOp,
  ctx: { slot: Slot; questions: Question[]; termCodes: ReadonlyMap<string, string> },
): { ok: true; mapping: ColumnMapping } | { ok: false; reason: string } {
  const entries = [...(mapping?.entries ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const renumber = (list: ColumnMappingEntry[]): ColumnMapping => ({
    version: 1,
    entries: list.map((e, order) => ({ ...e, order })),
  });
  const i = entries.findIndex((e) => columnKey(e) === op.id);
  const q = (key: string) => ctx.questions.find((x) => x.key === key);
  const fail = (reason: string) => ({ ok: false as const, reason });

  let next: ColumnMapping;
  if (op.op === "show") {
    const builtin = op.id.startsWith("builtin:") ? op.id.slice("builtin:".length) : null;
    if (i >= 0) {
      next = renumber([...entries.filter((_, j) => j !== i), { ...entries[i], hidden: false }]);
    } else if (builtin !== null) {
      if (!isBoardColumnBuiltin(builtin)) return fail("Unknown column.");
      next = showBuiltinColumn(renumber(entries), builtin);
    } else {
      const question = op.id.startsWith("q:") ? q(op.id.slice(2)) : undefined;
      if (!question) return fail("Unknown column.");
      next = renumber([
        ...entries,
        { role: "display", label: question.data.label, source: "question", questionKey: question.key },
      ]);
    }
  } else {
    if (i < 0) return fail("Unknown column.");
    const e = entries[i];
    const replace = (x: ColumnMappingEntry) => renumber(entries.map((y, j) => (j === i ? x : y)));
    switch (op.op) {
      case "hide":
        next = replace({ ...e, hidden: true });
        break;
      case "rename":
        if (!op.label) return fail("A column needs a name.");
        next = replace({ ...e, label: op.label });
        break;
      case "move":
        next = renumber(moveAmongVisible(entries, i, op.dir, (x) => !x.hidden));
        break;
      case "statusMap": {
        if (e.role !== "intent-status") return fail("Only a status column has status answers.");
        const { statusMap: _old, ...rest } = e;
        next = replace({ ...rest, ...parseStatusMap(op.statusMap) });
        break;
      }
      case "role": {
        if (e.source !== "question") return fail("Only a question column can feed staffing.");
        const question = q(e.questionKey);
        if (!question) return fail("That question is no longer on the form.");
        const { termId: _t, statusMap: _s, ...base } = e;
        if (op.role === "display") {
          next = replace({ ...base, role: "display", label: question.data.label });
          break;
        }
        const def = questionRoles(ctx.slot).find((d) => d.role === op.role);
        if (!def) return fail("Unknown staffing role.");
        if (!def.perTerm && op.termId) return fail("Unknown staffing role.");
        if (op.termId && !ctx.termCodes.has(op.termId)) return fail("Unknown term.");
        const position = entries.filter((x, j) => j !== i && x.role === def.role).length;
        const termCode = def.perTerm ? (op.termId ? ctx.termCodes.get(op.termId) : placeholder("term")) : undefined;
        const statusMap =
          def.role === "intent-status"
            ? e.role === "intent-status" && e.statusMap
              ? e.statusMap
              : defaultStatusMap(question.data.options ?? [])
            : undefined;
        next = replace({
          ...base,
          role: def.role,
          label: roleColumnLabel(def, position, termCode),
          ...(op.termId ? { termId: op.termId } : {}),
          ...(statusMap && Object.keys(statusMap).length > 0 ? { statusMap } : {}),
        });
        break;
      }
    }
  }
  const problem = mappingEntryProblem(ctx.slot, ctx.questions, next);
  if (problem && problem !== mappingEntryProblem(ctx.slot, ctx.questions, mapping)) return fail(problem);
  return { ok: true, mapping: next };
}

export type BoardColumn = {
  key: string;
  label: string;
  role?: string;
  // Status columns only: the question's options and what each one means.
  status?: { options: string[]; statusMap: Record<string, IntentStatusValue> };
};

// What a board's table needs for its columns: the visible ones (question
// columns carry their "Feeds staffing as" choice), what the + button can
// add, and the role choices for question columns.
export function boardTableModel(
  slot: Slot,
  mapping: ColumnMapping | null,
  visible: readonly { key: string; label: string; source: "question" | "builtin"; role: string; termId?: string }[],
  questions: readonly { key: string; label: string; options?: string[] }[],
  terms: readonly { id: string; code: string }[],
): { columns: BoardColumn[]; addable: { key: string; label: string }[]; roleChoices: RoleChoice[] } {
  const entries = [...(mapping?.entries ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const mappedQuestions = new Set(entries.flatMap((e) => (e.source === "question" ? [e.questionKey] : [])));
  const placedBuiltins = new Set(entries.flatMap((e) => (e.source === "builtin" ? [e.builtin] : [])));
  return {
    columns: visible.map((c) => {
      const entry = entries.find((e) => columnKey(e) === c.key);
      const options = questions.find((q) => entry?.source === "question" && q.key === entry.questionKey)?.options;
      return {
        key: c.key,
        label: c.label,
        ...(c.source === "question" ? { role: roleChoiceValue(c, slot) } : {}),
        ...(c.role === "intent-status"
          ? { status: { options: options ?? [], statusMap: entry?.statusMap ?? {} } }
          : {}),
      };
    }),
    addable: [
      ...entries.filter((e) => e.hidden).map((e) => ({ key: columnKey(e), label: e.label })),
      ...questions.filter((q) => !mappedQuestions.has(q.key)).map((q) => ({ key: `q:${q.key}`, label: q.label })),
      ...BOARD_COLUMN_BUILTINS.filter((b) => !placedBuiltins.has(b)).map((b) => ({
        key: `builtin:${b}`,
        label: BUILTIN_SOURCES[b].defaultLabel,
      })),
    ],
    roleChoices: questionRoleChoices(slot, terms),
  };
}
