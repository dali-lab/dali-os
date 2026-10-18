import { useEffect, useRef, useState } from "react";
import { Select, type SelectOption } from "~/components/ui/floating";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { buttonClasses } from "~/components/ui/Button";
import { actionItemMatchesBlock } from "./enhance-plan";
import { formatIsoDate, type UseMeetingRecording } from "./use-meeting-recording";

type ActionItemRowState = { checked: boolean; ownerUserId: string; dueAt: string };

/**
 * The rail's action items as editable rows stacked on two lines to fit 400px,
 * then Create tasks. Reviewing the changes themselves happens in the note.
 */
export function EnhancePreview({ rec }: { rec: UseMeetingRecording }) {
  const notes = rec.enhanceNotes;

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

  const liveBlocks = rec.getNoteState?.()?.blocks ?? [];

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
                // A checklist block Enhance wrote still carries this item's
                // text: keeping (or never having been reviewed yet) reads
                // "Task created". Revert removed/restored that line, so the
                // task it already made is now orphaned from the note's own
                // text — "Task kept" (specs/meeting-recording-rail.md Step
                // 2: "Revert on a block that already has a task... leaves
                // the task, with the rail row reading 'Task kept'").
                const stillWritten = liveBlocks.some(
                  (b) => b.type === "checkListItem" && actionItemMatchesBlock(item.text, b.text),
                );
                return (
                  <li key={i} className="flex flex-col gap-1 rounded-lg bg-os-well px-3 py-2 text-sm text-foreground">
                    <p>{item.text}</p>
                    <p className="text-xs text-muted-foreground">
                      {stillWritten ? "Task created" : "Task kept"}
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
