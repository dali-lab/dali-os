import { useEffect, useRef, useState } from "react";
import { Select, type SelectOption } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import { isUntouchedTemplate } from "~/lib/meeting-note-template";
import { applyEnhancePlan, type ApplyEnhancePlanResult } from "./enhance-plan";
import { formatClock } from "./transcript";
import { formatIsoDate, type UseMeetingRecording } from "./use-meeting-recording";

/** Recomputes Enhance's merge fresh from the live editor — shared by
 *  RecordingRail's "preview" status line and EnhancePreview's body, so the
 *  two never disagree on the counts. Null until notes + a live editor are
 *  both available. */
export function computeEnhancePreview(rec: UseMeetingRecording): ApplyEnhancePlanResult | null {
  if (!rec.enhanceNotes || !rec.getNoteState) return null;
  const state = rec.getNoteState();
  if (!state) return null;
  const untouchedTemplate = isUntouchedTemplate(
    { seededFromPageId: rec.seededFromPageId, seededTemplateHash: rec.seededTemplateHash },
    state.bodyText,
  );
  return applyEnhancePlan(rec.enhanceNotes.snapshot, state.blocks, rec.enhanceNotes.plan, { untouchedTemplate });
}

type ActionItemRowState = { checked: boolean; ownerUserId: string; dueAt: string };

/**
 * The rail's "preview" and "enhanced" body (specs/meeting-recording-rail.md):
 * each changed/added block with its heading for context (preview only), then
 * the action items as editable rows stacked on two lines to fit 400px, then
 * Create tasks. Apply/Cancel/Enhance again live in the rail's header, not
 * here.
 */
export function EnhancePreview({ rec, mode }: { rec: UseMeetingRecording; mode: "preview" | "enhanced" }) {
  const notes = rec.enhanceNotes;
  const preview = computeEnhancePreview(rec);
  const changed = preview?.ops.filter((op) => op.kind === "update") ?? [];
  const added = preview?.ops.filter((op) => op.kind === "insertAfter") ?? [];

  const [itemState, setItemState] = useState<Record<number, ActionItemRowState>>({});
  const [createTasksBusy, setCreateTasksBusy] = useState(false);
  const seededSnapshotAt = useRef<string | null>(null);
  useEffect(() => {
    if (!notes) {
      seededSnapshotAt.current = null;
      setItemState({});
      return;
    }
    if (seededSnapshotAt.current === notes.snapshotAt) return;
    seededSnapshotAt.current = notes.snapshotAt;
    const next: Record<number, ActionItemRowState> = {};
    notes.plan.actionItems.forEach((item, i) => {
      next[i] = { checked: true, ownerUserId: item.ownerUserId ?? "", dueAt: item.due ?? "" };
    });
    setItemState(next);
  }, [notes]);

  if (!notes) return null;

  // The plan's own roster (occurrence attendance + the note's project
  // current-term members, specs/meeting-notes-model.md §6) is more complete
  // than the page's occurrence-only roster prop.
  const rosterForOwners = notes.roster?.length ? notes.roster : rec.roster;
  const ownerOptions: SelectOption[] = [
    { value: "", label: "Unassigned" },
    ...rosterForOwners.map((r) => ({ value: r.userId, label: r.name })),
  ];

  async function handleCreateTasks() {
    const items = notes!.plan.actionItems
      .map((item, index) => ({ item, index, row: itemState[index] }))
      .filter(({ item, row }) => row?.checked && !item.taskId)
      .map(({ item, index, row }) => ({
        index,
        title: item.text,
        assigneeId: row!.ownerUserId || undefined,
        dueAt: row!.dueAt ? new Date(row!.dueAt).toISOString() : undefined,
      }));
    if (items.length === 0) return;
    setCreateTasksBusy(true);
    try {
      await rec.createTasksFromItems(items);
    } finally {
      setCreateTasksBusy(false);
    }
  }

  const pendingActionItems = notes.plan.actionItems.filter((item) => !item.taskId).length;
  const showCreateTasks = Boolean(rec.canCreateTasks && rec.projectId && pendingActionItems > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {mode === "preview" && (
        <div className="flex flex-col gap-2 rounded-xl bg-os-well px-3 py-3">
          {changed.length === 0 && added.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to change.</p>
          ) : (
            <>
              {changed.map((op) => op.kind === "update" && <EnhanceOpRow key={op.id} label="Changed" text={op.text} cites={op.cites} />)}
              {added.map(
                (op, i) =>
                  op.kind === "insertAfter" &&
                  op.blocks.map((b, j) => <EnhanceOpRow key={`${i}-${j}`} label="Added" text={b.text} cites={b.cites} />),
              )}
            </>
          )}
          {(notes.verified.droppedBlocks > 0 || notes.verified.droppedCites > 0) && (
            <p className="text-xs text-muted-foreground">
              {notes.verified.droppedBlocks > 0 &&
                `${notes.verified.droppedBlocks} addition${notes.verified.droppedBlocks === 1 ? "" : "s"} couldn't be verified against the transcript and were left out. `}
              {notes.verified.droppedCites > 0 &&
                `${notes.verified.droppedCites} citation${notes.verified.droppedCites === 1 ? "" : "s"} didn't match the transcript and were dropped.`}
            </p>
          )}
        </div>
      )}

      {notes.plan.actionItems.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">Action items</p>
            {showCreateTasks && (
              <button
                type="button"
                onClick={() => void handleCreateTasks()}
                disabled={createTasksBusy}
                className={buttonClasses("secondary", "sm")}
              >
                {createTasksBusy ? "Creating…" : "Create tasks"}
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {notes.plan.actionItems.map((item, i) => {
              const row = itemState[i];
              if (item.taskId) {
                return (
                  <li key={i} className="flex flex-col gap-1 rounded-lg bg-os-well px-3 py-2 text-sm text-foreground">
                    <p>{item.text}</p>
                    <p className="text-xs text-muted-foreground">
                      Task created
                      {rec.projectId && (
                        <>
                          {" · "}
                          <a href={`/projects/${rec.projectId}?tab=progress&task=${item.taskId}`} className="text-os-accent underline">
                            View task
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                );
              }
              if (!showCreateTasks) {
                return (
                  <li key={i} className="rounded-lg bg-os-well px-3 py-2 text-sm text-foreground">
                    <p>{item.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.ownerName ? (item.ownerUserId ? item.ownerName : `${item.ownerName}: no match on the roster`) : "Unassigned"}
                      {item.due && ` · ${formatIsoDate(item.due)}${item.dueSource ? ` (${item.dueSource})` : ""}`}
                    </p>
                  </li>
                );
              }
              return (
                <li key={i} className="flex flex-col gap-1.5 rounded-lg bg-os-well px-3 py-2 text-sm text-foreground">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      tone="os"
                      checked={row?.checked ?? true}
                      onChange={(e) =>
                        setItemState((s) => ({
                          ...s,
                          [i]: { ...(s[i] ?? { ownerUserId: "", dueAt: "" }), checked: e.target.checked },
                        }))
                      }
                    />
                    <p className="flex-1">{item.text}</p>
                  </div>
                  <div className="flex flex-wrap items-start gap-2 pl-6">
                    <div className="flex flex-col gap-1">
                      <Select
                        value={row?.ownerUserId ?? ""}
                        onChange={(value) =>
                          setItemState((s) => ({ ...s, [i]: { ...(s[i] ?? { checked: true, dueAt: "" }), ownerUserId: value } }))
                        }
                        options={ownerOptions}
                        ariaLabel="Owner"
                      />
                      {item.ownerName && !item.ownerUserId && (
                        <span className="text-[11px] text-muted-foreground">{item.ownerName}: no match on the roster</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <DateField
                        mode="date"
                        value={row?.dueAt ?? ""}
                        onChange={(value) =>
                          setItemState((s) => ({ ...s, [i]: { ...(s[i] ?? { checked: true, ownerUserId: "" }), dueAt: value } }))
                        }
                        ariaLabel="Due date"
                      />
                      {item.dueSource && <span className="text-[11px] text-muted-foreground">from &quot;{item.dueSource}&quot;</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function EnhanceOpRow({ label, text, cites }: { label: "Changed" | "Added"; text: string; cites: number[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-os-container bg-background px-3 py-2">
      <span
        className={cn(
          "self-start rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          label === "Added" ? "bg-os-accent/15 text-os-accent" : "bg-os-container text-muted-foreground",
        )}
      >
        {label}
      </span>
      <p className="text-sm text-foreground">
        {text}
        {cites.map((c) => (
          <span key={c} className="ml-1.5 rounded-full bg-os-accent/10 px-1.5 py-0.5 font-mono text-[11px] text-os-accent">
            {formatClock(c)}
          </span>
        ))}
      </p>
    </div>
  );
}
