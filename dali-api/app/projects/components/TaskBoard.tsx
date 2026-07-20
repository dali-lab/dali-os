import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "~/components/ui/Button";
import type { DragEndEvent } from "@dnd-kit/core";
import { Archive, GripVertical, X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
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
  // The acting user — stamped onto optimistically-created cards as
  // createdBy so the "Created by" line in the modal is correct before the
  // next revalidation lands (the server independently sets this from the
  // session, so it's display-only here).
  currentUserId: string;
  currentUserName: string;
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

export function TaskBoard({
  projectId,
  initialTasks,
  options,
  canManage,
  currentUserId,
  currentUserName,
}: Props) {
  // Optimistic board state + rollback live in the shared hook. This board solely
  // owns its task state; the parent project route revalidates on unrelated edits
  // (sprint changes, project rename, fetcher submits), which would otherwise
  // clobber an optimistic create/move/edit — so opt out of server adoption.
  const { items: tasks, move, error, setError, setItems } =
    useOptimisticBoardMove<TaskCardModel>(initialTasks, { adoptServerItems: false });
  const [isCreating, setIsCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

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

  // Apply an optimistic local patch, then PATCH the row. On failure the hook
  // restores the snapshot and surfaces the error. Used by both inline (card)
  // edits and the modal.
  async function patchTask(taskId: string, patch: Partial<TaskCardModel>) {
    move(
      (cur) => cur.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
      async () => {
        const body: Record<string, unknown> = {};
        if ("dueAt" in patch) body.dueAt = patch.dueAt;
        if ("domain" in patch) body.domainId = patch.domain?.id ?? null;
        if ("assignees" in patch)
          body.assigneeIds = (patch.assignees ?? []).map((a) => a.id);
        if ("title" in patch) body.title = patch.title;
        if ("description" in patch) body.description = patch.description;
        if ("priority" in patch) body.priority = patch.priority;
        if ("status" in patch) body.status = patch.status;
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
      },
    );
  }

  // Optimistically drop the card, then DELETE the row. The hook restores it
  // on failure and surfaces the error. Close the modal first so the deleted
  // task doesn't briefly render behind a rollback.
  function deleteTask(taskId: string) {
    setOpenTaskId(null);
    move(
      (cur) => cur.filter((t) => t.id !== taskId),
      () => persistDelete(taskId),
    );
  }

  // Manual archive from the modal's Status dropdown — same optimistic-remove
  // shape as delete, but the row is kept (archivedAt set) so it shows up in
  // the Archived modal.
  function archiveTask(taskId: string) {
    setOpenTaskId(null);
    move(
      (cur) => cur.filter((t) => t.id !== taskId),
      () => persistArchive(taskId),
    );
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

    const position = nextPositionInColumn(board, toStatus);
    move(
      (cur) =>
        cur.map((t) => (t.id === taskId ? { ...t, status: toStatus, position } : t)),
      () => persistMove(taskId, toStatus, position),
    );
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
        description: values.description,
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

    setItems((cur) => [
      ...cur,
      {
        id,
        title: values.title,
        description: values.description,
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
        createdBy: { id: currentUserId, name: currentUserName },
        createdAt: new Date().toISOString(),
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

  const columns: KanbanColumn<TaskCardModel>[] = TASK_STATUSES.map((status) => ({
    id: status,
    title: TASK_STATUS_LABELS[status],
    cards: board[status] ?? [],
    // The status columns keep the original taller drop zone.
    listClassName: "flex flex-col gap-2 p-2 min-h-[360px]",
  }));

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setIsCreating(true)}>
            + Add task
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowArchived(true)}
          >
            <Archive className="w-3.5 h-3.5" />
            Archived
          </Button>
        </div>
      )}

      <KanbanBoard<TaskCardModel>
        id="task-board"
        columns={columns}
        getCardId={(t) => t.id}
        getCardData={(t) => ({ taskId: t.id, fromStatus: t.status })}
        draggable={canManage}
        onDragEnd={handleDragEnd}
        error={error}
        renderCard={(card, { isDragging, dragHandleProps }) => (
          <TaskCard
            card={card}
            draggable={canManage}
            dragHandleProps={dragHandleProps}
            isDragging={isDragging}
            onOpen={() => setOpenTaskId(card.id)}
          />
        )}
      />

      {openTask && (
        <TaskModal
          task={openTask}
          options={options}
          canManage={canManage}
          onClose={() => setOpenTaskId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onDelete={() => deleteTask(openTask.id)}
          onArchive={() => archiveTask(openTask.id)}
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

      {showArchived && (
        <ArchivedTasksModal
          projectId={projectId}
          onClose={() => setShowArchived(false)}
        />
      )}
    </div>
  );
}

type ArchivedTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  archivedAt: string;
  domain: { id: string; name: string } | null;
  assignees: { id: string; name: string }[];
};

// Lazily fetches and lists a project's archived tasks. Read-only — archived
// tasks aren't editable/restorable from here (they live off the board by
// design); this is a record of what was auto-archived.
function ArchivedTasksModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<ArchivedTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/tasks`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const body = (await res.json()) as { tasks: ArchivedTask[] };
        if (!cancelled) setTasks(body.tasks);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="archived-tasks-title"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-xl w-full p-5 sm:p-6 my-auto max-h-[80vh] flex flex-col"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 id="archived-tasks-title" className="text-lg font-semibold text-foreground">
          Archived tasks
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
          aria-label="Close"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && tasks === null && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {tasks !== null && tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No archived tasks yet. Done/Cancelled tasks are archived automatically
          once they've been idle past the threshold.
        </p>
      )}

      {tasks !== null && tasks.length > 0 && (
        <ul className="flex flex-col gap-2 overflow-y-auto -mx-1 px-1">
          {tasks.map((t) => (
            <li
              key={t.id}
              className="border border-border rounded-md bg-background p-2.5 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground min-w-0 truncate">{t.title}</span>
                <span className="text-[11px] text-muted-foreground flex-shrink-0">
                  {TASK_STATUS_LABELS[t.status]}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className={PRIORITY_TONE[t.priority]}>{t.priority}</span>
                {t.domain && <span>· {t.domain.name}</span>}
                {t.assignees.length > 0 && (
                  <span className="truncate">
                    · {t.assignees.map((a) => a.name).join(", ")}
                  </span>
                )}
                <span className="ml-auto">
                  Archived {new Date(t.archivedAt).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// The drag handle and the card body are split so the body's click can open
// the modal without dnd-kit's pointer listeners swallowing it. Listeners go
// only on the GripVertical handle; the rest of the card is a role="button"
// div (not a real <button>, whose contents browsers refuse to let you
// select) so the title text can be drag-selected/copied. A drag that leaves
// a text selection inside the card is treated as a select, not an open.
// Keyboard activation (Enter/Space) still opens the modal.
function TaskCard({
  card,
  draggable,
  dragHandleProps,
  isDragging,
  onOpen,
}: {
  card: TaskCardModel;
  draggable: boolean;
  dragHandleProps: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const overdue =
    card.dueAt != null &&
    card.status !== "Done" &&
    card.status !== "Cancelled" &&
    new Date(card.dueAt).getTime() < Date.now();

  // Don't open the task if the click ended a text selection inside this card
  // (e.g. the user drag-selected the title to copy it).
  function handleActivate() {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (
      sel &&
      !sel.isCollapsed &&
      sel.toString().trim() !== "" &&
      sel.anchorNode &&
      bodyRef.current?.contains(sel.anchorNode)
    ) {
      return;
    }
    onOpen();
  }

  return (
    <div
      className={`border border-border rounded-md bg-background text-sm flex focus-within:ring-2 focus-within:ring-accent-coral/30 ${
        isDragging ? "opacity-60 shadow-lg" : "hover:bg-muted/20"
      }`}
    >
      {draggable && (
        <div
          {...dragHandleProps}
          aria-label="Drag task"
          className="flex-shrink-0 px-1 py-2.5 cursor-grab active:cursor-grabbing text-muted-foreground/60 hover:text-muted-foreground"
        >
          <GripVertical className="w-4 h-4" />
        </div>
      )}
      <div
        ref={bodyRef}
        role="button"
        tabIndex={0}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className="flex-1 min-w-0 text-left p-2.5 pl-1.5 cursor-pointer select-text focus:outline-none"
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
      </div>
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

async function persistDelete(taskId: string): Promise<void> {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
}

async function persistArchive(taskId: string): Promise<void> {
  const res = await fetch(`/api/tasks/${taskId}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived: true }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
}
