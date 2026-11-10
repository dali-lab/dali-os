import { useCallback, useEffect, useState } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { useRevalidator } from "react-router";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  Link2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { Menu, MenuItem, Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { LoadMore } from "~/components/ui/Pager";
import { useLoadMore, type CursorPage } from "~/hooks/useLoadMore";
import { Modal } from "~/components/Modal";
import type { KanbanColumn } from "~/components/board/KanbanBoard";
import {
  BOARD_TITLE_CLASS,
  boardTitleStyle,
  osStatusAccent,
  type StatusAccent,
} from "~/components/board/status-accent";
import { BoardCard, BoardCardMeta, BoardCardMetaRow, BoardCardChip } from "~/components/board/BoardCard";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
import { cn } from "~/lib/cn";
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
} from "../lib/task-board";
import { utcDayOf, localTodayUtcDay } from "../lib/timeline-days";
import type { NewTaskValues } from "./TaskModal";

export const META_TEXT = (os: boolean) => (os ? "text-xs" : "text-[11px]");

const STATUS_ACCENT_OS: Record<TaskStatus, StatusAccent> = {
  Backlog: osStatusAccent("backlog"),
  Todo: osStatusAccent("todo"),
  InProgress: osStatusAccent("progress"),
  InReview: osStatusAccent("review"),
  Done: osStatusAccent("done"),
  Cancelled: osStatusAccent("cancelled"),
};

const STATUS_ACCENT_CLASSIC: Record<TaskStatus, StatusAccent> = {
  Backlog: {
    fill: "var(--color-muted)",
    ink: "var(--color-foreground)",
    edge: "var(--color-brand-gray)",
  },
  Todo: {
    fill: "color-mix(in srgb, #7c5ce0 22%, transparent)",
    ink: "#5734b8",
    edge: "#7c5ce0",
  },
  InProgress: {
    fill: "color-mix(in srgb, var(--color-accent-teal) 22%, transparent)",
    ink: "#00706f",
    edge: "var(--color-accent-teal)",
  },
  InReview: {
    fill: "color-mix(in srgb, var(--color-accent-yellow) 30%, transparent)",
    ink: "#8a5300",
    edge: "var(--color-accent-yellow)",
  },
  Done: {
    fill: "color-mix(in srgb, var(--color-accent-green) 30%, transparent)",
    ink: "#166a41",
    edge: "var(--color-accent-green)",
  },
  Cancelled: {
    fill: "color-mix(in srgb, var(--color-muted) 50%, transparent)",
    ink: "var(--color-muted-foreground)",
    edge: "var(--color-border)",
  },
};

export const statusAccent = (status: TaskStatus, os: boolean): StatusAccent =>
  (os ? STATUS_ACCENT_OS : STATUS_ACCENT_CLASSIC)[status];

const COLLAPSIBLE_EMPTY_STATUSES: TaskStatus[] = ["Backlog", "Cancelled"];
const HIDE_EMPTY_KEY = "taskboard:hideEmptyCols";
const COLLAPSED_KEY = "taskboard:collapsedCols";

export function useColumnLayout() {
  const [hideEmptyCols, setHideEmptyCols] = useState(true);
  useEffect(() => {
    setHideEmptyCols(window.localStorage.getItem(HIDE_EMPTY_KEY) !== "0");
  }, []);
  const toggleHideEmpty = useCallback(() => {
    setHideEmptyCols((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(HIDE_EMPTY_KEY, next ? "1" : "0");
      } catch {
        /* private-mode / storage-disabled: fall back to in-memory only */
      }
      return next;
    });
  }, []);
  const [collapsedCols, setCollapsedCols] = useState<TaskStatus[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsedCols((JSON.parse(raw) as string[]).filter(isTaskStatus));
    } catch {
      /* unreadable / malformed: start expanded */
    }
  }, []);
  const persistCollapsed = useCallback((next: TaskStatus[]) => {
    setCollapsedCols(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* private-mode / storage-disabled: fall back to in-memory only */
    }
  }, []);
  const toggleCollapsed = useCallback(
    (status: TaskStatus) =>
      persistCollapsed(
        collapsedCols.includes(status)
          ? collapsedCols.filter((s) => s !== status)
          : [...collapsedCols, status],
      ),
    [collapsedCols, persistCollapsed],
  );
  return { hideEmptyCols, toggleHideEmpty, collapsedCols, toggleCollapsed, persistCollapsed };
}

export function buildStatusColumns({
  board,
  os,
  canManage,
  hideEmptyCols,
  collapsedCols,
  onToggleCollapsed,
  onAddTask,
}: {
  board: Record<TaskStatus, TaskCardModel[]>;
  os: boolean;
  canManage: boolean;
  hideEmptyCols: boolean;
  collapsedCols: TaskStatus[];
  onToggleCollapsed: (status: TaskStatus) => void;
  onAddTask: (status: TaskStatus) => void;
}): KanbanColumn<TaskCardModel>[] {
  return TASK_STATUSES.filter(
    (status) =>
      !(
        hideEmptyCols &&
        COLLAPSIBLE_EMPTY_STATUSES.includes(status) &&
        (board[status]?.length ?? 0) === 0
      ),
  ).map((status) => {
    const accent = statusAccent(status, os);
    const label = TASK_STATUS_LABELS[status];
    const cards = board[status] ?? [];
    const collapsed = collapsedCols.includes(status);
    const roundedTop = os ? "rounded-t-os-item" : "rounded-t-lg";
    const shell = os
      ? "flex-shrink-0 border border-transparent rounded-os-item bg-os-card flex flex-col"
      : "flex-shrink-0 border rounded-lg border-border bg-card flex flex-col";

    if (collapsed) {
      return {
        id: status,
        title: null,
        className: cn(shell, "w-11"),
        headerClassName: cn("flex items-center justify-center px-1 py-2", roundedTop),
        headerStyle: { background: accent.fill, color: accent.ink },
        headerExtra: (
          <Tooltip content={`Expand ${label}`}>
            <button
              type="button"
              onClick={() => onToggleCollapsed(status)}
              className="rounded p-0.5 text-current hover:bg-current/10"
              aria-label={`Expand ${label} column`}
            >
              <ChevronsRight className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        ),
        cards: [],
        listClassName: "flex flex-1 flex-col items-center gap-2 py-3",
        renderEmpty: () => (
          <Tooltip content={`Expand ${label}`}>
          <button
            type="button"
            onClick={() => onToggleCollapsed(status)}
            className="flex flex-1 flex-col items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            <span className={cn(META_TEXT(os), "font-medium")}>{cards.length}</span>
            <span
              className={cn("whitespace-nowrap", os ? "text-sm" : "text-xs")}
              style={{ writingMode: "vertical-rl" }}
            >
              {label}
            </span>
          </button>
          </Tooltip>
        ),
      };
    }

    return {
      id: status,
      title: <span className={BOARD_TITLE_CLASS} style={boardTitleStyle(accent)}>{label}</span>,
      className: cn(shell, "w-full md:w-64"),
      headerClassName: cn(
        "flex items-center justify-between gap-2 px-3 py-2",
        roundedTop,
      ),
      headerStyle: { background: accent.fill, color: accent.ink },
      headerExtra: (
        <div className="flex shrink-0 items-center gap-1 text-current">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium tabular-nums text-foreground",
              os ? "bg-os-bg" : "bg-background",
              META_TEXT(os),
            )}
          >
            {cards.length}
          </span>
          <Menu
            align="right"
            ariaLabel={`${label} column actions`}
            trigger={
              <button
                type="button"
                className="rounded p-0.5 text-current hover:bg-current/10"
                aria-label={`${label} column actions`}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            }
          >
            {canManage && (
              <MenuItem
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onSelect={() => onAddTask(status)}
              >
                Add task
              </MenuItem>
            )}
            <MenuItem
              icon={<ChevronsLeft className="h-4 w-4" aria-hidden />}
              onSelect={() => onToggleCollapsed(status)}
            >
              Collapse column
            </MenuItem>
          </Menu>
        </div>
      ),
      cards,
      listClassName:
        "flex flex-col gap-2 p-2 min-h-[360px] max-h-[calc(100vh-14rem)] overflow-y-auto",
      listHeader: canManage ? (
        <button
          type="button"
          onClick={() => onAddTask(status)}
          className={cn(
            "mb-2 flex w-full items-center justify-center gap-1.5 border border-dashed transition-colors",
            META_TEXT(os),
            os
              ? "rounded-os-item border-os-container py-2 text-os-grey hover:border-os-container-hi hover:bg-os-container/30 hover:text-foreground"
              : "rounded-md border-border py-1.5 text-muted-foreground hover:bg-muted/30 hover:text-foreground",
          )}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add new task
        </button>
      ) : null,
    };
  });
}

export function useTaskBoardActions({
  projectId,
  initialTasks,
  options,
  canManage,
  currentUserId,
  currentUserName,
  openTaskId,
}: {
  projectId: string;
  initialTasks: TaskCardModel[];
  options: TaskBoardOptions;
  canManage: boolean;
  currentUserId: string;
  currentUserName: string;
  openTaskId: string | null;
}) {
  const dialog = useDialog();
  const { items: tasks, move, error, setError, setItems } =
    useOptimisticBoardMove<TaskCardModel>(initialTasks);
  const [archiving, setArchiving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const revalidator = useRevalidator();

  const refresh = useCallback(() => {
    if (revalidator.state === "idle") void revalidator.revalidate();
  }, [revalidator]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const runArchive = useCallback(async () => {
    if (archiving) return;
    const archivable = tasks.filter((t) => t.status === "Done" || t.status === "Cancelled");
    const count = archivable.length;
    const confirmed = await dialog.confirm({
      title: "Archive Done & Cancelled tasks?",
      description: `This will immediately archive ${count} task${count === 1 ? "" : "s"} (Done and Cancelled). Archived tasks are hidden from the board but not deleted.`,
      confirmLabel: "Archive",
      tone: "destructive",
    });
    if (!confirmed) return;
    setArchiving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/archive`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Archive failed: ${res.status}`);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setArchiving(false);
    }
  }, [archiving, dialog, projectId, refresh, setError, tasks]);

  useEffect(() => {
    if (!openTaskId) return;
    const task = tasks.find((t) => t.id === openTaskId);
    if (!task?.hasUnread) return;
    setItems((cur) =>
      cur.map((t) => (t.id === openTaskId ? { ...t, hasUnread: false } : t)),
    );
    void fetch(`/api/tasks/${openTaskId}/view`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {
      /* best-effort — the dot just won't stay cleared next load */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTaskId]);

  function patchTask(
    taskId: string,
    patch: Partial<TaskCardModel>,
  ): Promise<{ ok: boolean; error?: string }> {
    const current = tasks.find((t) => t.id === taskId);
    const toStatus =
      patch.status && current && patch.status !== current.status ? patch.status : null;
    const { status: _status, ...fields } = patch;
    return new Promise((resolve) => {
      move(
        (cur) => {
          const moved = toStatus ? moveTaskInBoard(cur, taskId, toStatus, -1).tasks : cur;
          return moved.map((t) => (t.id === taskId ? { ...t, ...fields } : t));
        },
        async () => {
          const body: Record<string, unknown> = {};
          if ("dueAt" in patch) body.dueAt = patch.dueAt;
          if ("startsAt" in patch) body.startsAt = patch.startsAt;
          if ("domain" in patch) body.domainId = patch.domain?.id ?? null;
          if ("assignees" in patch)
            body.assigneeIds = (patch.assignees ?? []).map((a) => a.id);
          if ("title" in patch) body.title = patch.title;
          if ("description" in patch) body.description = patch.description;
          if ("epicId" in patch) body.epicId = patch.epicId ?? null;
          if ("storyId" in patch) body.storyId = patch.storyId ?? null;
          if ("dependsOn" in patch) body.dependsOn = patch.dependsOn ?? [];
          if ("checklist" in patch) body.checklist = patch.checklist ?? null;
          try {
            if (Object.keys(body).length > 0) {
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
            }
            if (toStatus) {
              const { orderedIds } = moveTaskInBoard(tasks, taskId, toStatus, -1);
              await persistMove(taskId, toStatus, orderedIds);
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : "Save failed";
            resolve({ ok: false, error: message });
            throw e;
          }
          refresh();
          resolve({ ok: true });
        },
      );
    });
  }

  async function deleteTask(taskId: string) {
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
      if (toStatus === fromStatus) return;
      targetIndex = -1;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask || overTask.id === taskId) return;
      toStatus = overTask.status;
      targetIndex = buildTaskBoard(tasks)[toStatus].findIndex(
        (t) => t.id === overId,
      );
    }

    const orderedIds = moveTaskInBoard(tasks, taskId, toStatus, targetIndex).orderedIds;
    move(
      (cur) => moveTaskInBoard(cur, taskId, toStatus, targetIndex).tasks,
      () => persistMove(taskId, toStatus, orderedIds).then(refresh),
    );
    if (toStatus === "Done" && fromStatus !== "Done") setCelebrate(true);
  }

  async function createTask(values: NewTaskValues, onAcked: () => void) {
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: values.title,
        description: values.description,
        status: values.status,
        dueAt: values.dueAt,
        startsAt: values.startsAt,
        epicId: values.epicId,
        storyId: values.storyId,
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
        status: values.status,
        priority: "Normal",
        position: nextPositionInColumn(buildTaskBoard(cur), values.status),
        dueAt: values.dueAt,
        startsAt: values.startsAt,
        epicId: values.epicId,
        storyId: values.storyId,
        dependsOn: [],
        checklist: values.checklist ?? null,
        assignees,
        domain,
        githubIssueUrl: null,
        githubIssueNumber: null,
        files: [],
        commentCount: 0,
        createdBy: { id: currentUserId, name: currentUserName },
        createdAt: new Date().toISOString(),
        activityAt: new Date().toISOString(),
        hasUnread: false,
      },
    ]);
    onAcked();

    const patch: Partial<TaskCardModel> = {};
    if (domain) patch.domain = domain;
    if (assignees.length > 0) patch.assignees = assignees;
    if (values.dependsOn.length > 0) patch.dependsOn = values.dependsOn;
    if (Object.keys(patch).length > 0) {
      await patchTask(id, patch);
    } else {
      refresh();
    }
  }

  return {
    tasks,
    error,
    setError,
    setItems,
    refresh,
    archiving,
    runArchive,
    celebrate,
    setCelebrate,
    patchTask,
    deleteTask,
    handleDragEnd,
    createTask,
  };
}

type ArchivedTask = {
  id: string;
  title: string;
  status: TaskStatus;
  dueAt: string | null;
  archivedAt: string;
  domain: { id: string; name: string } | null;
  assignees: { id: string; name: string }[];
};

async function fetchArchivedTasksPage(
  projectId: string,
  cursor?: string,
): Promise<CursorPage<ArchivedTask>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`/api/projects/${projectId}/tasks${query}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const body = (await res.json()) as { tasks: ArchivedTask[]; nextCursor: string | null };
  return { items: body.tasks, nextCursor: body.nextCursor };
}

export function ArchivedTasksModal({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const { os } = useOsChrome();
  const [first, setFirst] = useState<{ tasks: ArchivedTask[]; nextCursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchArchivedTasksPage(projectId)
      .then((page) => {
        if (!cancelled) setFirst({ tasks: page.items, nextCursor: page.nextCursor });
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const { items: tasks, pager } = useLoadMore<ArchivedTask>({
    items: first?.tasks ?? [],
    nextCursor: first?.nextCursor ?? null,
    fetchPage: (cursor) => fetchArchivedTasksPage(projectId, cursor),
    idOf: (t) => t.id,
  });

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="archived-tasks-title"
      containerClassName={cn(
        modalCardClass("max-w-xl max-h-[80vh]"),
        "flex flex-col",
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 id="archived-tasks-title" className="text-lg font-semibold text-foreground">
          Archived tasks
        </h2>
        <button
          type="button"
          onClick={onClose}
          className={
            os
              ? "os-icon-btn"
              : "text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
          }
          aria-label="Close"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && first === null && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {first !== null && tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No archived tasks yet. Use Archive on the board to clear Done/Cancelled
          tasks now, or wait for the weekly auto-archive of idle ones.
        </p>
      )}

      {first !== null && tasks.length > 0 && (
        <ul className="flex flex-col gap-2 overflow-y-auto -mx-1 px-1">
          {tasks.map((t) => (
            <li
              key={t.id}
              className={cn(
                "border p-2.5",
                os
                  ? "rounded-os-item border-transparent bg-os-well text-[15px]"
                  : "rounded-md border-border bg-background text-sm",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground min-w-0 truncate">{t.title}</span>
                <span className={cn(META_TEXT(os), "text-muted-foreground flex-shrink-0")}>
                  {TASK_STATUS_LABELS[t.status]}
                </span>
              </div>
              <div
                className={cn(
                  "mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground",
                  META_TEXT(os),
                )}
              >
                {t.domain && <span>{t.domain.name}</span>}
                {t.assignees.length > 0 && (
                  <span className="truncate">
                    {t.domain && "· "}
                    {t.assignees.map((a) => a.name).join(", ")}
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
      <LoadMore {...pager} />
    </Modal>
  );
}

export function TaskCard({
  card,
  blockedBy,
  dragHandleProps = {},
  isDragging,
  onOpen,
}: {
  card: TaskCardModel;
  blockedBy: TaskCardModel[];
  dragHandleProps?: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
}) {
  const { os } = useOsChrome();
  const overdue =
    card.dueAt != null &&
    card.status !== "Done" &&
    card.status !== "Cancelled" &&
    localTodayUtcDay() > utcDayOf(card.dueAt);

  const checklist = Array.isArray(card.checklist) ? card.checklist : null;
  const checklistDone = checklist?.filter((i) => i.done).length ?? 0;
  const dateRange = formatDateRange(card.startsAt, card.dueAt);

  return (
    <BoardCard
      accentEdge={statusAccent(card.status, os).edge}
      dragHandleProps={dragHandleProps}
      isDragging={isDragging}
      onOpen={onOpen}
      testId="task-card"
    >
        <div className="flex items-start gap-1.5">
          {card.hasUnread && (
            <Tooltip
              variant="rich"
              content={`Updated ${formatSince(card.activityAt)} ago — a field, comment, file, or description changed since you last opened it.`}
            >
              <Bell
                aria-label={`Updated ${formatSince(card.activityAt)} ago — you haven't opened it since`}
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  os ? "text-os-accent" : "text-os-accent",
                )}
              />
            </Tooltip>
          )}
          <span className="min-w-0 text-foreground">{card.title}</span>
        </div>

        {card.assignees.length > 0 && (
          <Tooltip content={card.assignees.map((a) => a.name).join(", ")}>
            <div
              className={cn(
                "mt-1 truncate text-muted-foreground",
                META_TEXT(os),
              )}
            >
              {card.assignees.map((a) => a.name).join(", ")}
            </div>
          </Tooltip>
        )}

        <BoardCardMetaRow>
          {blockedBy.length > 0 && (
            <BoardCardChip
              tone="warn"
              icon={<Lock aria-hidden className="w-3 h-3" />}
              title={`Waiting on ${blockedBy.map((b) => b.title).join(", ")}`}
            >
              Blocked
            </BoardCardChip>
          )}
          {dateRange && (
            <MetaItem
              icon={
                <CalendarDays
                  aria-hidden
                  className={cn(
                    "w-3.5 h-3.5",
                    overdue && (os ? "text-os-amber" : "text-os-accent"),
                  )}
                />
              }
              title={overdue ? `Overdue — ${dateRange}` : undefined}
            >
              {dateRange}
            </MetaItem>
          )}
          {checklist && checklist.length > 0 && (
            <MetaItem
              icon={<CheckSquare aria-hidden className="w-3.5 h-3.5" />}
              title={`${checklistDone} of ${checklist.length} subtasks done`}
            >
              {checklistDone}/{checklist.length}
            </MetaItem>
          )}
          {card.commentCount > 0 && (
            <MetaItem
              icon={<MessageSquare aria-hidden className="w-3.5 h-3.5" />}
              title={`${card.commentCount} comment${card.commentCount === 1 ? "" : "s"}`}
            >
              {card.commentCount}
            </MetaItem>
          )}
          {card.files.length > 0 && (
            <MetaItem
              icon={<Paperclip aria-hidden className="w-3.5 h-3.5" />}
              title={`${card.files.length} attached file${card.files.length === 1 ? "" : "s"}`}
            >
              {card.files.length}
            </MetaItem>
          )}
          {card.githubIssueNumber !== null && (
            <MetaItem
              icon={<Link2 aria-hidden className="w-3.5 h-3.5" />}
              title={`GitHub issue #${card.githubIssueNumber}`}
            >
              {card.githubIssueNumber}
            </MetaItem>
          )}
          {card.domain && (
            <span
              className={cn(
                "px-1.5 py-0.5 border",
                os
                  ? "rounded-full border-transparent bg-os-accent/15 text-os-accent"
                  : "rounded-md border-blue-100 bg-blue-50 text-blue-700",
              )}
            >
              {card.domain.name}
            </span>
          )}
        </BoardCardMetaRow>
    </BoardCard>
  );
}

const MetaItem = BoardCardMeta;

function formatDateRange(startsAt: string | null, dueAt: string | null): string | null {
  if (startsAt && dueAt) return `${formatDuePill(startsAt)} – ${formatDuePill(dueAt)}`;
  if (dueAt) return `Due ${formatDuePill(dueAt)}`;
  if (startsAt) return `Start ${formatDuePill(startsAt)}`;
  return null;
}

function formatSince(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return "1y+";
}

function formatDuePill(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
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
