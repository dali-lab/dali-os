import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { Select } from "~/components/ui/floating";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import {
  isTaskFinished,
  TASK_STATUS_LABELS,
  type TaskBoardOptions,
  type TaskCardModel,
} from "../lib/task-board";
import {
  sprintDays,
  sprintLabel,
  sprintRangeLabel,
  sprintStatus,
  type SprintModel,
} from "../lib/sprints";
import { localTodayUtcDay } from "../lib/timeline-days";
import { SprintAnchorControl } from "./SprintAnchorControl";
import { planBacklogMove, BACKLOG_COLUMN } from "../lib/backlog";

/**
 * Sprint planning: the ranked backlog beside the active and upcoming sprints.
 * Dragging a card into a sprint schedules it; dragging it back unschedules it;
 * dragging within the backlog re-ranks it.
 */
export function BacklogView({
  projectId,
  initialTasks,
  options,
  canManage,
  onOpenTask,
}: {
  projectId: string;
  initialTasks: TaskCardModel[];
  options: TaskBoardOptions;
  canManage: boolean;
  onOpenTask: (taskId: string) => void;
}) {
  const { os } = useOsChrome();
  const revalidator = useRevalidator();
  const { items: tasks, move, error, setError } = useOptimisticBoardMove<TaskCardModel>(initialTasks);
  const [epicFilter, setEpicFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => {
    if (revalidator.state === "idle") void revalidator.revalidate();
  }, [revalidator]);
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const today = useMemo(() => localTodayUtcDay(), []);
  const multiTerm = new Set(options.sprints.map((s) => s.termId)).size > 1;
  const openSprints = useMemo(
    () =>
      options.sprints
        .filter((s) => sprintStatus(sprintDays(s), today) !== "Closed")
        .sort((a, z) => Date.parse(a.startsOn) - Date.parse(z.startsOn)),
    [options.sprints, today],
  );
  const epicTitle = useMemo(() => new Map(options.epics.map((e) => [e.id, e.title])), [options.epics]);

  const backlog = useMemo(
    () =>
      tasks
        .filter((t) => t.sprintId === null && !isTaskFinished(t))
        .sort((a, z) => a.position - z.position || a.createdAt.localeCompare(z.createdAt)),
    [tasks],
  );
  const shown = (t: TaskCardModel) => !epicFilter || t.epicId === epicFilter;

  const columns: KanbanColumn<TaskCardModel>[] = [
    {
      id: BACKLOG_COLUMN,
      title: "Backlog",
      count: backlog.length,
      cards: backlog.filter(shown),
      className: columnShell(os, "w-full md:w-80"),
      headerClassName: "flex items-center justify-between gap-2 px-3 py-2",
      listClassName: "flex flex-col gap-2 p-2 min-h-[360px] max-h-[calc(100vh-14rem)] overflow-y-auto",
      listHeader: canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addToBacklog();
          }}
          className="mb-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={adding}
            placeholder="Add a task to the backlog…"
            aria-label="New backlog task"
            className="w-full rounded-md border border-dashed border-border bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </form>
      ) : null,
      renderEmpty: () => (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          Nothing waiting. New ideas land here until they're pulled into a sprint.
        </p>
      ),
    },
    ...openSprints.map((s) => sprintColumn(s, os, multiTerm, today, tasks.filter((t) => t.sprintId === s.id && t.status !== "Cancelled" && shown(t)))),
  ];

  async function addToBacklog() {
    const title = draft.trim();
    if (!title) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, epicId: epicFilter || null, sprintId: null }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      setDraft("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the task");
    } finally {
      setAdding(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!canManage) return;
    const overId = event.over?.id;
    const taskId = (event.active.data.current as { taskId?: string } | undefined)?.taskId;
    if (!taskId || typeof overId !== "string") return;
    const plan = planBacklogMove(tasks, taskId, overId);
    if (!plan) return;
    move(
      () => plan.tasks,
      async () => {
        const res = await fetch(`/api/tasks/${taskId}/move`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plan.body),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Request failed: ${res.status}`);
        }
        refresh();
      },
    );
  }

  return (
    <div className={cn("flex flex-col", os ? "gap-4" : "gap-3")}>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={epicFilter}
          onChange={setEpicFilter}
          ariaLabel="Filter by epic"
          options={[
            { value: "", label: "All epics" },
            ...options.epics.map((e) => ({ value: e.id, label: e.title })),
          ]}
        />
        <p className={cn("text-muted-foreground", os ? "text-sm" : "text-xs")}>
          Drag work into a sprint to schedule it. Unfinished tasks roll to the next sprint when one closes.
        </p>
        <div className="ml-auto">
          <SprintAnchorControl
            projectId={projectId}
            anchors={options.anchors}
            canEdit={canManage}
            focusTermId={openSprints[0]?.termId ?? null}
            onSaved={refresh}
          />
        </div>
      </div>
      {openSprints.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No current or upcoming sprints — add a current or future term to the project to generate them.
        </p>
      )}
      <KanbanBoard<TaskCardModel>
        id="backlog-board"
        columns={columns}
        getCardId={(t) => t.id}
        getCardData={(t) => ({ taskId: t.id })}
        draggable={canManage}
        sortable
        dropPlaceholder
        onDragEnd={handleDragEnd}
        error={error}
        renderCard={(t, { isDragging, dragHandleProps }) => (
          <PlanCard
            task={t}
            epic={t.epicId ? epicTitle.get(t.epicId) ?? null : null}
            isDragging={isDragging}
            dragHandleProps={dragHandleProps}
            onOpen={() => onOpenTask(t.id)}
          />
        )}
      />
    </div>
  );
}

function columnShell(os: boolean, width: string) {
  return cn(
    "flex-shrink-0 flex flex-col",
    width,
    os ? "border border-transparent rounded-os-item bg-os-card" : "border rounded-lg border-border bg-card",
  );
}

function sprintColumn(
  s: SprintModel,
  os: boolean,
  multiTerm: boolean,
  today: number,
  cards: TaskCardModel[],
): KanbanColumn<TaskCardModel> {
  const active = sprintStatus(sprintDays(s), today) === "Active";
  return {
    id: s.id,
    title: (
      <span className="flex flex-col">
        <span>
          {sprintLabel(s, multiTerm)}
          {active && <span className="ml-2 text-xs font-medium text-accent-teal">Current</span>}
        </span>
        <span className="text-xs font-normal text-muted-foreground">{sprintRangeLabel(s)}</span>
      </span>
    ),
    count: cards.length,
    cards: [...cards].sort((a, z) => a.position - z.position),
    className: columnShell(os, "w-full md:w-64"),
    headerClassName: "flex items-center justify-between gap-2 px-3 py-2",
    listClassName: "flex flex-col gap-2 p-2 min-h-[360px] max-h-[calc(100vh-14rem)] overflow-y-auto",
    renderEmpty: () => (
      <p className="px-2 py-6 text-center text-sm text-muted-foreground">Drop tasks here</p>
    ),
  };
}

function PlanCard({
  task,
  epic,
  isDragging,
  dragHandleProps,
  onOpen,
}: {
  task: TaskCardModel;
  epic: string | null;
  isDragging: boolean;
  dragHandleProps: Record<string, unknown>;
  onOpen: () => void;
}) {
  const { os } = useOsChrome();
  return (
    <div
      {...dragHandleProps}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      data-testid="plan-card"
      className={cn(
        "cursor-pointer border p-2.5 text-sm focus:outline-none focus:ring-2",
        os ? "rounded-os-item border-transparent bg-os-well focus:ring-os-accent/40" : "rounded-md border-border bg-background focus:ring-accent-coral/30",
        isDragging && "opacity-40",
      )}
    >
      <div className="text-foreground">{task.title}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {epic && <span className="truncate">{epic}</span>}
        <span>{TASK_STATUS_LABELS[task.status]}</span>
        {task.carryoverCount > 0 && <span>Carried ×{task.carryoverCount}</span>}
        {task.assignees.length > 0 && (
          <span className="truncate">{task.assignees.map((a) => a.name).join(", ")}</span>
        )}
      </div>
    </div>
  );
}
