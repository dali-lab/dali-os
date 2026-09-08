// "Columns" builder for a staffing slot's database view, shown inside the
// Advanced settings modal on the Project Bids / Intent to Work boards.
//
// The bound form is fully flexible; here a manager picks which form question
// backs each column the slot needs. Role-bearing columns (project / domain /
// notes / intent-status) are STATIC — their name and meaning are fixed by
// the role registry (SLOT_ROLES) so a manager only attaches a question to
// them. Builtins (Submitted by / Hired roles) are likewise static and
// resolved server-side. Only free-form "display" columns expose an editable
// label.
//
// To add another role-bearing column (e.g. a 4th project pick or an extra
// per-term status column) the manager uses the role-specific "+ Add" button.
// Slot-parameterised via SLOT_ROLES, so adding a slot is a registry change,
// not a component change.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useFetcher } from "react-router";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { Select, Tooltip } from "~/components/ui/floating";
import {
  SLOT_ROLES,
  BUILTIN_SOURCES,
  REQUIRED_BUILTINS,
  isBuiltinSource,
  missingRequirements,
  type ColumnMapping,
  type ColumnMappingEntry,
  type RoleDef,
} from "~/projects/lib/slot-roles";
import type { Slot } from "~/projects/lib/form-slots";

type FormQuestion = {
  key: string;
  label: string;
  type: string;
  referenceSource?: string;
};

// One editable column in the builder. `role` is the meaning it carries
// (project/domain/notes feed staffing; display is view-only). Builtin columns
// carry their builtin's fixed role.
type DraftCol = {
  // Local-only stable id for React keys + reorder (never persisted).
  uid: string;
  source: "question" | "builtin";
  questionKey: string; // "" until a question is chosen
  builtin: string; // "" for question columns
  role: string;
  termId?: string;
  label: string;
  hidden: boolean;
};

let _uid = 0;
const nextUid = () => `c${_uid++}`;

// Static label for a role-bearing column. Repeatable roles get a positional
// suffix (1, 2, 3) over the existing entries of the same role; per-term roles
// get the term code. The label travels with the saved entry but is not
// user-editable for role-bearing columns.
function roleColumnLabel(
  def: RoleDef,
  positionAmongRole: number,
  termCode?: string,
): string {
  if (def.perTerm && termCode) {
    return `${def.defaultLabel} — ${termCode}`;
  }
  if (def.repeatable) {
    return `${def.defaultLabel} ${positionAmongRole + 1}`;
  }
  return def.defaultLabel;
}

export function SlotColumnMapper({
  slot,
  questions,
  mapping,
  cycleTerms,
  canManage,
}: {
  slot: Slot;
  questions: FormQuestion[];
  mapping: ColumnMapping | null;
  // Terms this cycle collects (only used by the per-term intent-status role).
  cycleTerms: { id: string; code: string }[];
  canManage: boolean;
}) {
  const fetcher = useFetcher();
  const saving = fetcher.state !== "idle";
  const error =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;

  // The non-builtin role palette for this slot. "display" is the catch-all
  // view-only column with an editable label; everything else is a fixed-name
  // role-bearing column.
  const slotRoles = SLOT_ROLES[slot];
  const termById = useMemo(
    () => new Map(cycleTerms.map((t) => [t.id, t.code])),
    [cycleTerms],
  );

  const initial = useMemo<DraftCol[]>(() => {
    // First-time setup (no saved mapping): seed the slot's required spine so
    // a manager opens the mapper with the required columns already laid out,
    // and only has to pick a backing question for each. The seeded rows are
    // local-only until the manager Saves; the Save button stays disabled
    // until every required question column has a chosen questionKey.
    if (!mapping || mapping.entries.length === 0) {
      const seeded: DraftCol[] = [];
      for (const def of slotRoles) {
        const need = def.requiredCount ?? 0;
        for (let i = 0; i < need; i++) {
          seeded.push({
            uid: nextUid(),
            source: "question",
            questionKey: "",
            builtin: "",
            role: def.role,
            label: roleColumnLabel(def, i),
            hidden: false,
          });
        }
      }
      for (const name of REQUIRED_BUILTINS[slot]) {
        seeded.push({
          uid: nextUid(),
          source: "builtin",
          questionKey: "",
          builtin: name,
          role: name,
          label: BUILTIN_SOURCES[name].defaultLabel,
          hidden: false,
        });
      }
      return seeded;
    }
    return [...mapping.entries]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => ({
        uid: nextUid(),
        source: e.source,
        questionKey: e.source === "question" ? e.questionKey : "",
        builtin: e.source === "builtin" ? e.builtin : "",
        role: e.role,
        termId: e.termId,
        label: e.label,
        hidden: e.hidden === true,
      }));
  }, [mapping, slot, slotRoles]);

  const [cols, setCols] = useState<DraftCol[]>(initial);
  const dirty = JSON.stringify(cols) !== JSON.stringify(initial);

  function patch(uid: string, p: Partial<DraftCol>) {
    setCols((cs) => cs.map((c) => (c.uid === uid ? { ...c, ...p } : c)));
  }
  function addRoleColumn(def: RoleDef, termId?: string) {
    setCols((cs) => {
      const positionAmongRole = cs.filter((c) => c.role === def.role).length;
      const termCode = termId ? termById.get(termId) : undefined;
      return [
        ...cs,
        {
          uid: nextUid(),
          source: "question",
          questionKey: "",
          builtin: "",
          role: def.role,
          termId,
          label: roleColumnLabel(def, positionAmongRole, termCode),
          hidden: false,
        },
      ];
    });
  }
  function addDisplayColumn() {
    setCols((cs) => [
      ...cs,
      {
        uid: nextUid(),
        source: "question",
        questionKey: "",
        builtin: "",
        role: "display",
        label: "Column",
        hidden: false,
      },
    ]);
  }
  function addBuiltin(name: string) {
    if (!isBuiltinSource(name)) return;
    setCols((cs) => [
      ...cs,
      {
        uid: nextUid(),
        source: "builtin",
        questionKey: "",
        builtin: name,
        // Builtin's role IS its name (submitter/hiredRoles) — both are
        // registry roles with a matching constraint.
        role: name,
        label: BUILTIN_SOURCES[name].defaultLabel,
        hidden: false,
      },
    ]);
  }
  function remove(uid: string) {
    setCols((cs) => cs.filter((c) => c.uid !== uid));
  }
  // Move a row to position `targetIndex` in the current list. The index is
  // an INSERTION index (0 = before the first row, cs.length = at the end), so
  // dropping the source onto itself is a no-op and the math doesn't have to
  // special-case "moving forward vs backward".
  function moveTo(uid: string, targetIndex: number) {
    setCols((cs) => {
      const from = cs.findIndex((c) => c.uid === uid);
      if (from < 0) return cs;
      const clampedTarget = Math.max(0, Math.min(cs.length, targetIndex));
      // Removing first then inserting shifts the insertion point if we were
      // moving forward: account for that so the dropped row lands exactly
      // where the indicator was drawn.
      const insertAt =
        clampedTarget > from ? clampedTarget - 1 : clampedTarget;
      if (insertAt === from) return cs;
      const next = [...cs];
      const [moved] = next.splice(from, 1);
      next.splice(insertAt, 0, moved);
      return next;
    });
  }

  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = cols.findIndex((c) => c.uid === String(active.id));
    const toIdx = cols.findIndex((c) => c.uid === String(over.id));
    if (fromIdx < 0 || toIdx < 0) return;
    // Direct splice reorder: remove the dragged item then insert at the target
    // position. This is equivalent to arrayMove and preserves the exact visual
    // position the user dropped onto.
    setCols((cs) => {
      const next = [...cs];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }

  function save() {
    const entries: ColumnMappingEntry[] = [];
    cols.forEach((c, order) => {
      const common = {
        role: c.role,
        label: c.label.trim() || "Column",
        order,
        ...(c.termId ? { termId: c.termId } : {}),
        ...(c.hidden ? { hidden: true as const } : {}),
      };
      if (c.source === "builtin") {
        if (!isBuiltinSource(c.builtin)) return;
        entries.push({ ...common, source: "builtin", builtin: c.builtin });
      } else {
        if (!c.questionKey) return; // a question column with no question is dropped
        entries.push({
          ...common,
          source: "question",
          questionKey: c.questionKey,
        });
      }
    });
    const payload: ColumnMapping = { version: 1, entries };
    fetcher.submit(
      { intent: "set-slot-mapping", mapping: JSON.stringify(payload) },
      { method: "post" },
    );
  }

  // Which builtins aren't placed yet (each builtin is single-use).
  const placedBuiltins = new Set(
    cols.filter((c) => c.source === "builtin").map((c) => c.builtin),
  );
  const availableBuiltins = Object.entries(BUILTIN_SOURCES).filter(
    ([name]) => !placedBuiltins.has(name),
  );

  // Per-term roles (intent-status) can be added once per term — surface a
  // separate "+ Status (term)" button for each term not yet placed. Display
  // and builtin add buttons are rendered separately.
  type RoleAddOption =
    | { kind: "role"; def: RoleDef }
    | { kind: "role-perterm"; def: RoleDef; termId: string; termCode: string };
  const roleAddOptions: RoleAddOption[] = useMemo(() => {
    const out: RoleAddOption[] = [];
    for (const def of slotRoles) {
      if (def.constraint === "person" || def.constraint === "display") continue;
      if (def.perTerm) {
        const placedTermIds = new Set(
          cols
            .filter((c) => c.role === def.role && c.termId)
            .map((c) => c.termId as string),
        );
        for (const t of cycleTerms) {
          if (placedTermIds.has(t.id)) continue;
          out.push({
            kind: "role-perterm",
            def,
            termId: t.id,
            termCode: t.code,
          });
        }
        continue;
      }
      const placedCount = cols.filter((c) => c.role === def.role).length;
      // A role with a fixed required shape (project: requiredCount 3) caps
      // at that count; the spine is seeded on first load, so the add button
      // is only ever useful for adding above the floor. A non-repeatable
      // role caps at one. Either way: once the cap is hit, hide the button.
      if (!def.repeatable && placedCount >= 1) continue;
      if (def.requiredCount != null && placedCount >= def.requiredCount)
        continue;
      out.push({ kind: "role", def });
    }
    return out;
  }, [slotRoles, cols, cycleTerms]);

  // Live-mirror of what missingRequirements will say against the unsaved
  // draft. A non-empty list blocks save and is shown inline so a manager sees
  // what's still needed before clicking.
  const draftMapping: ColumnMapping = useMemo(
    () => ({
      version: 1,
      entries: cols.flatMap((c, order): ColumnMappingEntry[] => {
        const common = {
          role: c.role,
          label: c.label.trim() || "Column",
          order,
          ...(c.termId ? { termId: c.termId } : {}),
          ...(c.hidden ? { hidden: true as const } : {}),
        };
        if (c.source === "builtin") {
          return isBuiltinSource(c.builtin)
            ? [{ ...common, source: "builtin", builtin: c.builtin }]
            : [];
        }
        return c.questionKey
          ? [{ ...common, source: "question", questionKey: c.questionKey }]
          : [];
      }),
    }),
    [cols],
  );
  const missing = missingRequirements(slot, draftMapping);

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">Columns</div>
        {cols.length === 0 && (
          <span className="text-[11px] text-muted-foreground">
            No columns yet
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        Attach a form question to each column. Role columns have fixed names;
        only the <em>extra</em> display columns let you set a label.
        Submissions are always recorded.
      </p>

      <DndContext
        sensors={dragSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={cols.map((c) => c.uid)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col">
        {cols.map((c, i) => {
          const isBuiltin = c.source === "builtin";
          const isDisplay = c.role === "display";
          return (
            <SortableColRow key={c.uid} uid={c.uid} canManage={canManage} saving={saving}>
              {(dragHandleProps) => (
              <>
                {/* Drag handle — only this element starts a drag, so inputs
                    and buttons inside the row stay normally interactive.
                    Hidden for viewers (canManage=false). */}
                {canManage ? (
                  <button
                    type="button"
                    {...dragHandleProps}
                    aria-label={`Reorder ${c.label}`}
                    disabled={saving}
                    className="dnd-touch-handle cursor-grab active:cursor-grabbing px-1.5 py-1 text-muted-foreground hover:text-foreground select-none disabled:opacity-40"
                  >
                    ⋮⋮
                  </button>
                ) : null}

                {/* Column name — static for role/builtin columns, editable
                    only for the free-form display column. */}
                {isDisplay && canManage ? (
                  <input
                    aria-label={`Label for column ${i + 1}`}
                    value={c.label}
                    disabled={saving}
                    onChange={(e) => patch(c.uid, { label: e.target.value })}
                    placeholder="Column name"
                    className="min-w-0 lg:w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                  />
                ) : (
                  <Tooltip content={c.label}>
                    <div className="min-w-0 text-sm font-medium text-foreground truncate">
                      {c.label}
                      {isBuiltin && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          (automatic)
                        </span>
                      )}
                    </div>
                  </Tooltip>
                )}

                {/* Backing question — builtins resolve server-side, role and
                    display columns both pick a form question. */}
                {isBuiltin ? (
                  <div className="min-w-0 text-sm text-muted-foreground italic truncate">
                    Resolved automatically
                  </div>
                ) : canManage ? (
                  <Select
                    ariaLabel={`Question for ${c.label}`}
                    value={c.questionKey}
                    disabled={saving}
                    onChange={(v) => patch(c.uid, { questionKey: v })}
                    options={[
                      { value: "", label: "— Pick a question —" },
                      ...questions.map((q) => ({
                        value: q.key,
                        label: `${q.label} (${q.type})`,
                      })),
                    ]}
                    buttonClassName="min-w-0 w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                  />
                ) : (
                  <Tooltip
                    content={
                      questions.find((q) => q.key === c.questionKey)?.label ??
                      c.questionKey ??
                      null
                    }
                  >
                    <div
                      className="min-w-0 text-sm text-foreground truncate"
                    >
                      {questions.find((q) => q.key === c.questionKey)?.label ??
                        c.questionKey ??
                        "—"}
                    </div>
                  </Tooltip>
                )}

                {canManage && (
                  <div className="flex items-center gap-1 shrink-0 lg:justify-self-end">
                    <Checkbox
                      label="In table"
                      className="text-xs text-muted-foreground mr-1 select-none"
                      checked={!c.hidden}
                      disabled={saving}
                      onChange={(e) =>
                        patch(c.uid, { hidden: !e.target.checked })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${c.label}`}
                      onClick={() => remove(c.uid)}
                      disabled={saving}
                      className="px-2 py-1 text-xs border border-border rounded-md text-destructive disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </>
              )}
            </SortableColRow>
          );
        })}
          </div>
        </SortableContext>
      </DndContext>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {canManage && missing.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Still need: {missing.join(", ")}.
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {roleAddOptions.map((opt, idx) =>
            opt.kind === "role-perterm" ? (
              <button
                key={`${opt.def.role}@${opt.termId}`}
                type="button"
                onClick={() => addRoleColumn(opt.def, opt.termId)}
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-60"
              >
                + {opt.def.defaultLabel} ({opt.termCode})
              </button>
            ) : (
              <button
                key={`${opt.def.role}-${idx}`}
                type="button"
                onClick={() => addRoleColumn(opt.def)}
                disabled={saving}
                className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-60"
              >
                + {opt.def.defaultLabel}
              </button>
            ),
          )}
          {availableBuiltins.map(([name, def]) => (
            <button
              key={name}
              type="button"
              onClick={() => addBuiltin(name)}
              disabled={saving}
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-60"
            >
              + {def.defaultLabel}
            </button>
          ))}
          <button
            type="button"
            onClick={addDisplayColumn}
            disabled={saving || questions.length === 0}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-60"
          >
            + Extra column
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={save}
            disabled={saving || !dirty || missing.length > 0}
            className="ml-auto"
          >
            {saving ? "Saving…" : "Save columns"}
          </Button>
        </div>
      )}
    </div>
  );
}

// Sortable row shell — owns the useSortable hook so it can be called at the
// component level (not inside a .map callback, which violates rules-of-hooks).
// Renders as the grid row; passes handle props down via render-prop so the
// caller can spread them onto the grip button while keeping inputs interactive.
function SortableColRow({
  uid,
  canManage,
  saving,
  children,
}: {
  uid: string;
  canManage: boolean;
  saving: boolean;
  children: (dragHandleProps: Record<string, unknown>) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: uid, disabled: !canManage || saving });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const dragHandleProps = { ...attributes, ...listeners } as Record<string, unknown>;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`py-2 flex flex-col gap-2 border-b border-border last:border-b-0 lg:grid lg:items-center ${
        canManage
          ? "lg:grid-cols-[auto_14rem_minmax(0,1fr)_auto]"
          : "lg:grid-cols-[14rem_minmax(0,1fr)]"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      {children(dragHandleProps)}
    </div>
  );
}
