import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { Button } from "~/components/ui/Button";
import type { DragEndEvent } from "@dnd-kit/core";
import { Archive, Github, X } from "lucide-react";
import { Confetti } from "~/components/Confetti";
import { Modal } from "~/components/Modal";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
import {
  buildTaskBoard,
  moveTaskInBoard,
  nextPositionInColumn,
  isTaskStatus,
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
  /** Core/Admin or anyone staffed on the project can drag + create. Others get a read-only board. */
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

// New tasks land in the first column ("To do") unless the modal picked a
// status-affecting sprint; they can be dragged onward from there. One add
// affordance for the whole board, not per column.
const CREATE_STATUS: TaskStatus = TASK_STATUSES[0];

// The `?sprint=` filter value for backlog (tasks with no sprint).
const BACKLOG = "backlog";

export function TaskBoard({
  projectId,
  initialTasks,
  options,
  canManage,
  currentUserId,
  currentUserName,
}: Props) {
  // Optimistic board state + rollback live in the shared hook. Server data is
  // adopted whenever it changes and no save is in flight, so teammate edits,
  // GitHub webhook updates, and sprint rollovers appear without a manual
  // reload; our own mutations trigger a revalidation below to close the loop.
  const { items: tasks, move, error, setError, setItems } =
    useOptimisticBoardMove<TaskCardModel>(initialTasks);
  const [isCreating, setIsCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const revalidator = useRevalidator();

  // Pull fresh board state after each successful mutation (so GitHub issue
  // links etc. surface) and when the window regains focus (so someone else's
  // edits appear when you come back to the tab).
  const refresh = useCallback(() => {
    if (revalidator.state === "idle") void revalidator.revalidate();
  }, [revalidator]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  // The open task is tracked in the URL (`?task=<id>`) so GitHub issue mirrors
  // and other external links can deep-link straight to a task. The sprint
  // filter lives in `?sprint=` for the same reason (shareable board slices).
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get("task");
  const sprintFilter = searchParams.get("sprint");
  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );
  const setOpenTaskId = useCallback(
    (id: string | null) => setParam("task", id),
    [setParam],
  );

  const filteredTasks = useMemo(() => {
    if (!sprintFilter) return tasks;
    if (sprintFilter === BACKLOG) return tasks.filter((t) => t.sprintId === null);
    return tasks.filter((t) => t.sprintId === sprintFilter);
  }, [tasks, sprintFilter]);

  const board = useMemo(() => buildTaskBoard(filteredTasks), [filteredTasks]);
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  // Apply an optimistic local patch, then PATCH the row. On failure the hook
  // restores the snapshot and surfaces the error. Used by both inline (card)
  // edits and the modal; the returned result lets the modal stay open and
  // show the error inline instead of closing over a failed save.
  function patchTask(
    taskId: string,
    patch: Partial<TaskCardModel>,
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
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
          if ("sprintId" in patch) body.sprintId = patch.sprintId ?? null;
          if ("epicId" in patch) body.epicId = patch.epicId ?? null;
          if ("checklist" in patch) body.checklist = patch.checklist ?? null;
          const res = await fetch(`/api/tasks/${taskId}`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            const message = j.error ?? `Request failed: ${res.status}`;
            resolve({ ok: false, error: message });
            throw new Error(message);
          }
          refresh();
          resolve({ ok: true });
        },
      );
    });
  }

  async function deleteTask(taskId: string) {
    setOpenTaskId(null);
    move(
      (cur) => cur.filter((t) => t.id !== taskId),
      async () => {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Request failed: ${res.status}`);
        }
        refresh();
      },
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

    let toStatus: TaskStatus;
    let targetIndex: number;
    if (isTaskStatus(overId)) {
      toStatus = overId;
      targetIndex = -1; // dropped on the column shell: append
      if (toStatus === fromStatus && !sprintFilter) {
        // Same column, no card target — nothing to reorder.
        return;
      }
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask || overTask.id === taskId) return;
      toStatus = overTask.status;
      if (sprintFilter) {
        // With a sprint slice active the visible order isn't the full column
        // order, so card-relative indexes would scramble hidden tasks. Allow
        // status moves (append) but not reordering.
        if (toStatus === fromStatus) return;
        targetIndex = -1;
      } else {
        targetIndex = buildTaskBoard(tasks)[toStatus].findIndex(
          (t) => t.id === overId,
        );
      }
    }
    if (toStatus === fromStatus && targetIndex === -1 && sprintFilter) return;

    const orderedIds = moveTaskInBoard(tasks, taskId, toStatus, targetIndex).orderedIds;
    move(
      (cur) => moveTaskInBoard(cur, taskId, toStatus, targetIndex).tasks,
      () => persistMove(taskId, toStatus, orderedIds).then(refresh),
    );
    if (toStatus === "Done" && fromStatus !== "Done") setCelebrate(true);
  }

  // Create from the modal. The POST endpoint applies title/status/dueAt/
  // sprint/epic; priority/domain/assignees are applied with a follow-up PATCH
  // via the same optimistic path the card edits use.
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
        sprintId: values.sprintId,
        epicId: values.epicId,
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
        position: nextPositionInColumn(buildTaskBoard(cur), CREATE_STATUS),
        dueAt: values.dueAt,
        epicId: values.epicId,
        sprintId: values.sprintId,
        checklist: values.checklist ?? null,
        assignees,
        domain,
        // The GH issue is filed async after we ack; the link surfaces on the
        // next revalidation. Null here means no badge in the meantime.
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
    } else {
      refresh();
    }
  }

  const columns: KanbanColumn<TaskCardModel>[] = TASK_STATUSES.map((status) => ({
    id: status,
    title: TASK_STATUS_LABELS[status],
    cards: board[status] ?? [],
    // The status columns keep the original taller drop zone.
    listClassName: "flex flex-col gap-2 p-2 min-h-[360px]",
  }));

  // Sprint pills: Active first, then Planned, then Closed (options.sprints
  // arrive in that order from the loader), plus Backlog for sprint-less tasks.
  const showSprintFilter = options.sprints.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <Confetti trigger={celebrate} onFire={() => setCelebrate(false)} />
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <>
            <Button variant="primary" size="sm" onClick={() => setIsCreating(true)}>
              + Add task
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowArchived(true)}>
              <Archive className="w-3.5 h-3.5" />
              Archived
            </Button>
          </>
        )}
        {showSprintFilter && (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by sprint">
            <SprintPill
              label="All"
              active={sprintFilter === null}
              onClick={() => setParam("sprint", null)}
            />
            {options.sprints.map((s) => (
              <SprintPill
                key={s.id}
                label={s.name}
                activeSprint={s.status === "Active"}
                active={sprintFilter === s.id}
                onClick={() => setParam("sprint", sprintFilter === s.id ? null : s.id)}
              />
            ))}
            <SprintPill
              label="Backlog"
              active={sprintFilter === BACKLOG}
              onClick={() => setParam("sprint", sprintFilter === BACKLOG ? null : BACKLOG)}
            />
          </div>
        )}
      </div>

      <KanbanBoard<TaskCardModel>
        id="task-board"
        columns={columns}
        getCardId={(t) => t.id}
        getCardData={(t) => ({ taskId: t.id, fromStatus: t.status })}
        draggable={canManage}
        sortable
        onDragEnd={handleDragEnd}
        error={error}
        renderOverlay={(activeId) => {
          const t = activeId ? tasks.find((x) => x.id === activeId) : null;
          return t ? (
            <div className="w-60 rotate-1 shadow-xl">
              <TaskCard card={t} isDragging={false} onOpen={() => {}} />
            </div>
          ) : null;
        }}
        renderCard={(card, { isDragging, dragHandleProps }) => (
          <TaskCard
            card={card}
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
        />
      )}

      {isCreating && (
        <TaskModal
          options={options}
          canManage={canManage}
          defaultSprintId={
            sprintFilter && sprintFilter !== BACKLOG ? sprintFilter : null
          }
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

function SprintPill({
  label,
  active,
  activeSprint = false,
  onClick,
}: {
  label: string;
  active: boolean;
  activeSprint?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? "border-accent-coral bg-accent-coral/10 text-accent-coral"
          : "border-border text-muted-foreground hover:bg-muted/30"
      }`}
    >
      {activeSprint && (
        <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-accent-teal" />
      )}
      {label}
    </button>
  );
}

// The whole card is the drag source: the KanbanBoard pointer sensor's
// activation distance disambiguates click from drag, so a press-and-release
// still opens the modal while a press-and-move starts a drag. The one
// exception is the title, which swallows pointerdown so its text can be
// drag-selected/copied (a real <button> body would refuse selection
// entirely); a click that ended a selection inside the card is treated as a
// select, not an open. Keyboard activation (Enter/Space) also opens the
// modal so the card stays operable without a pointer.
function TaskCard({
  card,
  dragHandleProps = {},
  isDragging,
  onOpen,
}: {
  card: TaskCardModel;
  dragHandleProps?: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const overdue =
    card.dueAt != null &&
    card.status !== "Done" &&
    card.status !== "Cancelled" &&
    new Date(card.dueAt).getTime() < Date.now();

  const checklist = Array.isArray(card.checklist) ? card.checklist : null;
  const checklistDone = checklist?.filter((i) => i.done).length ?? 0;

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
      {...dragHandleProps}
      className={`border border-border rounded-md bg-background text-sm flex focus-within:ring-2 focus-within:ring-accent-coral/30 ${
        isDragging ? "opacity-40" : "hover:bg-muted/20"
      }`}
    >
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
        className="flex-1 min-w-0 text-left p-2.5 cursor-pointer focus:outline-none"
      >
        <div
          className="text-foreground select-text"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {card.title}
        </div>
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
          {checklist && checklist.length > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md border border-border text-muted-foreground">
              {checklistDone}/{checklist.length}
            </span>
          )}
          {card.githubIssueNumber !== null && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
              <Github aria-hidden className="w-3 h-3" />#{card.githubIssueNumber}
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
  orderedIds: string[],
): Promise<void> {
  const res = await fetch(`/api/tasks/${taskId}/move`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, orderedIds }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
}
