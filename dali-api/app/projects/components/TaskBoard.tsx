import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import {
  buildTaskBoard,
  nextPositionInColumn,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskBoardOptions,
  type TaskCardModel,
  type TaskStatus,
  type Priority,
} from "../lib/task-board";
import { TaskModal, type NewTaskValues } from "./TaskModal";

type Props = {
  projectId: string;
  initialTasks: TaskCardModel[];
  options: TaskBoardOptions;
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

export function TaskBoard({ projectId, initialTasks, options, canManage }: Props) {
  const [tasks, setTasks] = useState<TaskCardModel[]>(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // The open task is tracked in the URL (`?task=<id>`) so GitHub issue mirrors
  // and other external links can deep-link straight to a task.
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get("task");
  const setOpenTaskId = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("task", id);
          else next.delete("task");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );

  const board = useMemo(() => buildTaskBoard(tasks), [tasks]);
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  // Apply an optimistic local patch, then PATCH the row. On failure restore
  // and surface the error. Used by both inline (card) edits and the modal.
  async function patchTask(taskId: string, patch: Partial<TaskCardModel>) {
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if ("dueAt" in patch) body.dueAt = patch.dueAt;
      if ("domain" in patch) body.domainId = patch.domain?.id ?? null;
      if ("assignees" in patch) body.assigneeIds = (patch.assignees ?? []).map((a) => a.id);
      if ("title" in patch) body.title = patch.title;
      if ("priority" in patch) body.priority = patch.priority;
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
    } catch (err) {
      setTasks(prev);
      setError(err instanceof Error ? err.message : "Failed to update task");
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

  // Create from the modal. The POST endpoint only takes title/status/dueAt, so
  // priority/domain/assignees are applied with a follow-up PATCH via the same
  // optimistic path the card edits use.
  async function handleCreate(values: NewTaskValues) {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: values.title,
        status: CREATE_STATUS,
        dueAt: values.dueAt,
        ...(values.github ? { github: values.github } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Request failed: ${res.status}`);
      throw new Error("create failed");
    }
    const { id } = (await res.json()) as { id: string };

    const domain =
      values.domainId == null
        ? null
        : options.domains.find((d) => d.id === values.domainId) ?? null;
    const assignees = values.assigneeIds.map((aid) => {
      const m = options.members.find((m) => m.id === aid);
      return { id: aid, name: m?.name ?? "" };
    });

    setTasks((cur) => [
      ...cur,
      {
        id,
        title: values.title,
        status: CREATE_STATUS,
        priority: values.priority,
        position: nextPositionInColumn(board, CREATE_STATUS),
        dueAt: values.dueAt,
        epicId: null,
        sprintId: null,
        assignees,
        domain,
        // The GH issue is filed async after we ack; the link surfaces on the
        // next loader refresh. Null here means no badge in the meantime.
        githubIssueUrl: null,
        githubIssueNumber: null,
      },
    ]);
    setIsCreating(false);

    // Push the fields the create endpoint doesn't accept. patchTask owns its
    // own optimistic update + rollback, so the card already reflects them.
    const patch: Partial<TaskCardModel> = {};
    if (values.priority !== "Normal") patch.priority = values.priority;
    if (domain) patch.domain = domain;
    if (assignees.length > 0) patch.assignees = assignees;
    if (Object.keys(patch).length > 0) {
      await patchTask(id, patch);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {canManage && (
        <div>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
          >
            + Add task
          </button>
        </div>
      )}

      {/* Stable id so SSR/client agree when multiple DndContexts mount. */}
      <DndContext id="task-board" onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-3">
          {TASK_STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              cards={board[status] ?? []}
              canManage={canManage}
              onOpen={(id) => setOpenTaskId(id)}
            />
          ))}
        </div>
      </DndContext>

      {openTask && (
        <TaskModal
          task={openTask}
          options={options}
          canManage={canManage}
          onClose={() => setOpenTaskId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
        />
      )}

      {isCreating && (
        <TaskModal
          options={options}
          canManage={canManage}
          onClose={() => setIsCreating(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

function Column({
  status,
  cards,
  canManage,
  onOpen,
}: {
  status: TaskStatus;
  cards: TaskCardModel[];
  canManage: boolean;
  onOpen: (taskId: string) => void;
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

      <div className="flex flex-col gap-2 p-2 min-h-[360px]">
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
              onOpen={() => onOpen(card.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// The drag handle and the card body are split so the body's click can open
// the modal without dnd-kit's pointer listeners swallowing it. Listeners go
// only on the GripVertical handle; the rest of the card has a regular
// onClick. Keyboard activation (Enter/Space) also opens the modal so the
// card stays operable without a pointer.
function TaskCard({
  card,
  draggable,
  onOpen,
}: {
  card: TaskCardModel;
  draggable: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    data: { taskId: card.id, fromStatus: card.status },
    disabled: !draggable,
  });

  const style: React.CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : {};

  const overdue =
    card.dueAt != null &&
    card.status !== "Done" &&
    card.status !== "Cancelled" &&
    new Date(card.dueAt).getTime() < Date.now();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border border-border rounded-md bg-background text-sm flex ${
        isDragging ? "opacity-60 shadow-lg" : "hover:bg-muted/20"
      }`}
    >
      {draggable && (
        <div
          {...attributes}
          {...listeners}
          aria-label="Drag task"
          className="flex-shrink-0 px-1 py-2.5 cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-muted-foreground"
        >
          <GripVertical className="w-4 h-4" />
        </div>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left p-2.5 pl-1.5 focus:outline-none focus:ring-2 focus:ring-accent-coral/30 rounded-md"
      >
        <div className="text-foreground">{card.title}</div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className={`text-[11px] ${PRIORITY_TONE[card.priority]}`}>
            {card.priority}
          </span>
          {card.assignees.length > 0 && (
            <span className="text-[11px] text-muted-foreground truncate">
              {card.assignees.map((a) => a.name).join(", ")}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.dueAt && (
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded-md border ${
                overdue
                  ? "border-accent-coral/40 text-accent-coral bg-accent-coral/10"
                  : "border-border text-muted-foreground"
              }`}
            >
              Due {formatDuePill(card.dueAt)}
            </span>
          )}
          {card.domain && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
              {card.domain.name}
            </span>
          )}
        </div>
      </button>
    </div>
  );
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
