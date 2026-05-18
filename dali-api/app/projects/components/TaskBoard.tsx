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

export function TaskBoard({ projectId, initialTasks, canManage }: Props) {
  const [tasks, setTasks] = useState<TaskCardModel[]>(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<TaskStatus | null>(null);

  const board = useMemo(() => buildTaskBoard(tasks), [tasks]);

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

  async function handleCreate(status: TaskStatus, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, status }),
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
          status,
          priority: "Normal",
          position: nextPositionInColumn(board, status),
          epicId: null,
          sprintId: null,
          assigneeNames: [],
        },
      ]);
      setCreatingIn(null);
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
              isCreating={creatingIn === status}
              onStartCreate={() => setCreatingIn(status)}
              onCancelCreate={() => setCreatingIn(null)}
              onCreate={(title) => handleCreate(status, title)}
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
  isCreating,
  onStartCreate,
  onCancelCreate,
  onCreate,
}: {
  status: TaskStatus;
  cards: TaskCardModel[];
  canManage: boolean;
  isCreating: boolean;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (title: string) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const [draft, setDraft] = useState("");

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
        {cards.length === 0 && !isCreating ? (
          <div className="text-xs text-muted-foreground italic text-center py-4">
            Empty
          </div>
        ) : (
          cards.map((card) => (
            <TaskCard key={card.id} card={card} draggable={canManage} />
          ))
        )}

        {isCreating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCreate(draft);
              setDraft("");
            }}
            className="flex flex-col gap-1.5"
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onCancelCreate();
                  setDraft("");
                }
              }}
              placeholder="Task title"
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
            <div className="flex gap-1.5">
              <button
                type="submit"
                className="px-2 py-1 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  onCancelCreate();
                  setDraft("");
                }}
                className="px-2 py-1 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          canManage && (
            <button
              type="button"
              onClick={onStartCreate}
              className="text-xs text-muted-foreground hover:text-foreground text-left px-2 py-1.5 rounded-md hover:bg-muted/30 transition-colors"
            >
              + Add task
            </button>
          )
        )}
      </div>
    </div>
  );
}

function TaskCard({ card, draggable }: { card: TaskCardModel; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    data: { taskId: card.id, fromStatus: card.status },
    disabled: !draggable,
  });

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : {};

  const dragProps = draggable ? { ...attributes, ...listeners } : {};

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
    </div>
  );
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
