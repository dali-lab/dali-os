import { useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import {
  buildTaskBoard,
  nextPositionInColumn,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskCardModel,
  type TaskStatus,
  type Priority,
} from "../lib/task-board";

type Props = {
  projectId: string;
  initialTasks: TaskCardModel[];
  /** Admin/Core can drag + create. Others get a read-only board. */
  canManage: boolean;
};

const PRIORITY_TONE: Record<Priority, string> = {
  Low: "text-muted-foreground",
  Normal: "text-muted-foreground",
  High: "text-accent-coral",
  Urgent: "text-accent-coral font-semibold",
};

// New tasks always land in the first column ("To do"); they can be dragged
// onward from there. One add affordance for the whole board, not per column.
const CREATE_STATUS: TaskStatus = TASK_STATUSES[0];

export function TaskBoard({ projectId, initialTasks, canManage }: Props) {
  const [tasks, setTasks] = useState<TaskCardModel[]>(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState("");
  // Optional <input type="date"> value for the new task. Empty = no deadline.
  const [draftDueAt, setDraftDueAt] = useState("");

  const board = useMemo(() => buildTaskBoard(tasks), [tasks]);

  // Optimistic update for an inline due-date change. On failure the caller
  // restores the previous value; we centralise both the local-state write
  // and the network call so the two paths stay in sync.
  async function handleDueAtChange(taskId: string, isoOrNull: string | null) {
    const prev = tasks;
    setTasks((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, dueAt: isoOrNull } : t)),
    );
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: isoOrNull }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }
    } catch (err) {
      setTasks(prev);
      setError(err instanceof Error ? err.message : "Failed to update deadline");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!canManage) return;
    const overId = event.over?.id;
    if (!overId || typeof overId !== "string") return;
    const data = event.active.data.current as
      | { taskId?: string; fromStatus?: TaskStatus }
      | undefined;
    const taskId = data?.taskId;
    const fromStatus = data?.fromStatus;
    if (!taskId || !fromStatus) return;
    const toStatus = overId as TaskStatus;
    if (toStatus === fromStatus) return;

    const prev = tasks;
    const position = nextPositionInColumn(board, toStatus);
    setTasks((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, status: toStatus, position } : t)),
    );
    setError(null);

    void persistMove(taskId, toStatus, position).catch((err) => {
      setTasks(prev);
      setError(err instanceof Error ? err.message : "Failed to move task");
    });
  }

  async function handleCreate(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    // `<input type="date">` produces a date-only string (YYYY-MM-DD). Send
    // the ISO timestamp pinned to end-of-day local time so reminders fire at
    // a sensible hour rather than midnight UTC.
    const dueAtIso = draftDueAt
      ? endOfDayIso(draftDueAt)
      : null;
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          status: CREATE_STATUS,
          dueAt: dueAtIso,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      setTasks((cur) => [
        ...cur,
        {
          id,
          title: trimmed,
          status: CREATE_STATUS,
          priority: "Normal",
          position: nextPositionInColumn(board, CREATE_STATUS),
          dueAt: dueAtIso,
          epicId: null,
          sprintId: null,
          assigneeNames: [],
        },
      ]);
      setDraft("");
      setDraftDueAt("");
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* One add affordance for the whole board. New tasks enter the first
          column and can be dragged onward. */}
      {canManage && (
        <div>
          {isCreating ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleCreate(draft);
              }}
              className="flex flex-wrap items-center gap-1.5"
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsCreating(false);
                    setDraft("");
                    setDraftDueAt("");
                  }
                }}
                placeholder={`New task in "${TASK_STATUS_LABELS[CREATE_STATUS]}"`}
                className="flex-1 max-w-sm px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
              <input
                type="date"
                aria-label="Due date (optional)"
                value={draftDueAt}
                onChange={(e) => setDraftDueAt(e.target.value)}
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreating(false);
                  setDraft("");
                  setDraftDueAt("");
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
            >
              + Add task
            </button>
          )}
        </div>
      )}

      {/* Stable id so SSR/client agree when multiple DndContexts mount (see
          StaffingBoard for the hydration-mismatch rationale). */}
      <DndContext id="task-board" onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {TASK_STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              cards={board[status] ?? []}
              canManage={canManage}
              onDueAtChange={handleDueAtChange}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function Column({
  status,
  cards,
  canManage,
  onDueAtChange,
}: {
  status: TaskStatus;
  cards: TaskCardModel[];
  canManage: boolean;
  onDueAtChange: (taskId: string, isoOrNull: string | null) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-64 border rounded-lg border-border bg-card ${
        isOver ? "ring-2 ring-accent-coral/40" : ""
      } flex flex-col`}
    >
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">
          {TASK_STATUS_LABELS[status]}
        </div>
        <div className="text-[11px] text-muted-foreground">{cards.length}</div>
      </div>

      <div className="flex flex-col gap-2 p-2 min-h-[120px]">
        {cards.length === 0 ? (
          <div className="text-xs text-muted-foreground italic text-center py-4">
            Empty
          </div>
        ) : (
          cards.map((card) => (
            <TaskCard
              key={card.id}
              card={card}
              draggable={canManage}
              canManage={canManage}
              onDueAtChange={onDueAtChange}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskCard({
  card,
  draggable,
  canManage,
  onDueAtChange,
}: {
  card: TaskCardModel;
  draggable: boolean;
  canManage: boolean;
  onDueAtChange: (taskId: string, isoOrNull: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    data: { taskId: card.id, fromStatus: card.status },
    disabled: !draggable,
  });
  const [isEditingDue, setIsEditingDue] = useState(false);

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : {};

  const dragProps = draggable ? { ...attributes, ...listeners } : {};
  const overdue =
    card.dueAt != null &&
    card.status !== "Done" &&
    card.status !== "Cancelled" &&
    new Date(card.dueAt).getTime() < Date.now();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...dragProps}
      className={`border border-border rounded-md bg-background p-2.5 text-sm ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-60 shadow-lg" : "hover:bg-muted/20"}`}
    >
      <div className="text-foreground">{card.title}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={`text-[11px] ${PRIORITY_TONE[card.priority]}`}>
          {card.priority}
        </span>
        {card.assigneeNames.length > 0 && (
          <span className="text-[11px] text-muted-foreground truncate">
            {card.assigneeNames.join(", ")}
          </span>
        )}
      </div>
      {/* Due date row: a small pill when set, a subtle "+ Due" affordance
          when not. Both open an inline date editor for managers. The editor
          uses pointer/keyboard events with stopPropagation so the dnd-kit
          drag listeners on the card don't swallow input focus. */}
      {isEditingDue && canManage ? (
        <div
          className="mt-2 flex items-center gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            type="date"
            autoFocus
            defaultValue={card.dueAt ? dateInputValue(card.dueAt) : ""}
            onBlur={(e) => {
              const next = e.currentTarget.value;
              const nextIso = next ? endOfDayIso(next) : null;
              if (nextIso !== card.dueAt) onDueAtChange(card.id, nextIso);
              setIsEditingDue(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setIsEditingDue(false);
              }
            }}
            className="px-1.5 py-1 text-[11px] border border-border rounded-md bg-background text-foreground"
          />
          {card.dueAt && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDueAtChange(card.id, null);
                setIsEditingDue(false);
              }}
              className="text-[11px] text-muted-foreground hover:text-destructive"
            >
              clear
            </button>
          )}
        </div>
      ) : card.dueAt ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (canManage) setIsEditingDue(true);
          }}
          disabled={!canManage}
          className={`mt-2 text-[11px] px-1.5 py-0.5 rounded-md border ${
            overdue
              ? "border-accent-coral/40 text-accent-coral bg-accent-coral/10"
              : "border-border text-muted-foreground"
          } ${canManage ? "hover:bg-muted/40" : ""}`}
        >
          Due {formatDuePill(card.dueAt)}
        </button>
      ) : canManage ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setIsEditingDue(true);
          }}
          className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
        >
          + Due
        </button>
      ) : null}
    </div>
  );
}

// Convert an ISO timestamp to the YYYY-MM-DD value an `<input type="date">`
// expects, in the user's local timezone (so a deadline picked as "Mar 12"
// shows up as Mar 12 on the editor regardless of how it serialized to UTC).
function dateInputValue(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// A date-only input (YYYY-MM-DD) is timezone-agnostic on the client; pin it
// to end-of-day LOCAL time so a deadline of "Mar 12" doesn't fire its
// reminder a day early in Eastern. Returns an ISO UTC string.
function endOfDayIso(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  // 23:59:59 local time on the chosen day.
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59);
  return local.toISOString();
}

// Short label for the pill: "Mar 12" if it's this year, otherwise "Mar 12, 2027".
function formatDuePill(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

async function persistMove(
  taskId: string,
  status: TaskStatus,
  position: number,
): Promise<void> {
  const res = await fetch(`/api/tasks/${taskId}/move`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, position }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
}
