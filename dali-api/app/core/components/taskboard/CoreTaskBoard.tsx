import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { Confetti } from "~/components/Confetti";
import { KanbanBoard } from "~/components/board/KanbanBoard";
import { useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { SearchInput } from "~/components/ui/SearchInput";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { useSearchParamState } from "~/hooks/useSearchParamState";
import { filterCoreTasks, parseAssigneeParam } from "~/core/lib/taskboard";
import { PeopleFilter } from "~/projects/components/PeopleFilter";
import { TaskModal } from "~/projects/components/TaskModal";
import { CORE_TASK_MODAL_FEATURES } from "~/projects/components/task-modal-features";
import {
  TaskCard,
  buildStatusColumns,
  useColumnLayout,
  useTaskBoardActions,
} from "~/projects/components/task-board-shared";
import {
  buildTaskBoard,
  isTaskFinished,
  openDependencies,
  type TaskBoardOptions,
  type TaskCardModel,
  type TaskStatus,
} from "~/projects/lib/task-board";

export function CoreTaskBoard({
  projectId,
  initialTasks,
  options,
  currentUserId,
  currentUserName,
}: {
  projectId: string;
  initialTasks: TaskCardModel[];
  options: TaskBoardOptions;
  currentUserId: string;
  currentUserName: string;
}) {
  const { os } = useOsChrome();
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get("task");
  const [query, setQuery] = useSearchParamState("q", { debounceMs: 250 });
  const [assigneeParam, setAssigneeParam] = useSearchParamState("assignee");
  const [mineParam, setMineParam] = useSearchParamState("mine");
  const assigneeIds = useMemo(() => parseAssigneeParam(assigneeParam), [assigneeParam]);
  const mine = mineParam === "1";

  const {
    tasks,
    error,
    setItems,
    refresh,
    celebrate,
    setCelebrate,
    patchTask,
    deleteTask,
    handleDragEnd,
    createTask,
  } = useTaskBoardActions({
    projectId,
    initialTasks,
    options,
    canManage: true,
    currentUserId,
    currentUserName,
    openTaskId,
  });
  const { hideEmptyCols, collapsedCols, toggleCollapsed } = useColumnLayout();

  const [creating, setCreating] = useState(false);
  const [createStatus, setCreateStatus] = useState<TaskStatus>("Todo");
  const startCreate = useCallback((status: TaskStatus) => {
    setCreateStatus(status);
    setCreating(true);
  }, []);

  const setOpenTaskId = useCallback(
    (id: string | null) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("task", id);
          else next.delete("task");
          return next;
        },
        { replace: true, preventScrollReset: true },
      ),
    [setSearchParams],
  );

  const visible = useMemo(
    () => filterCoreTasks(tasks, { assigneeIds, mine, currentUserId, query }),
    [tasks, assigneeIds, mine, currentUserId, query],
  );
  const board = useMemo(() => buildTaskBoard(visible), [visible]);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const blockersOf = useCallback(
    (t: TaskCardModel) => openDependencies(t.dependsOn, tasksById, isTaskFinished),
    [tasksById],
  );
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  const columns = buildStatusColumns({
    board,
    os,
    canManage: true,
    hideEmptyCols,
    collapsedCols,
    onToggleCollapsed: toggleCollapsed,
    onAddTask: startCreate,
  });

  return (
    <div className="flex flex-col gap-4">
      <Confetti trigger={celebrate} onFire={() => setCelebrate(false)} />
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search Core tasks"
          containerClassName="w-56 shrink-0 sm:w-72"
        />
        <PeopleFilter
          options={options.members}
          selected={assigneeIds}
          onChange={(ids) => setAssigneeParam(ids.join(","))}
          emptyLabel="All assignees"
        />
        <ToggleChip on={mine} onToggle={() => setMineParam(mine ? "" : "1")}>
          Only mine
        </ToggleChip>
        <Button className="ml-auto" onClick={() => startCreate("Todo")}>
          <Plus className="h-4 w-4" aria-hidden />
          New task
        </Button>
      </div>

      {tasks.length > 0 && visible.length === 0 && (
        <div className="flex items-center gap-3 text-sm text-os-grey">
          No tasks match these filters.
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setQuery("");
              setAssigneeParam("");
              setMineParam("");
            }}
          >
            Clear filters
          </Button>
        </div>
      )}

      <KanbanBoard<TaskCardModel>
        id="core-task-board"
        columns={columns}
        getCardId={(t) => t.id}
        getCardData={(t) => ({ taskId: t.id, fromStatus: t.status })}
        draggable
        sortable
        dropPlaceholder
        onDragEnd={handleDragEnd}
        error={error}
        renderOverlay={(activeId) => {
          const t = activeId ? tasks.find((x) => x.id === activeId) : null;
          return t ? (
            <div className="w-60 rotate-1 shadow-xl">
              <TaskCard card={t} blockedBy={blockersOf(t)} isDragging={false} onOpen={() => {}} />
            </div>
          ) : null;
        }}
        renderCard={(card, { isDragging, dragHandleProps }) => (
          <TaskCard
            card={card}
            blockedBy={blockersOf(card)}
            dragHandleProps={dragHandleProps}
            isDragging={isDragging}
            onOpen={() => setOpenTaskId(card.id)}
          />
        )}
      />

      {openTask && (
        <TaskModal
          task={openTask}
          projectId={projectId}
          options={options}
          allTasks={tasks}
          features={CORE_TASK_MODAL_FEATURES}
          onOpenTask={setOpenTaskId}
          canManage
          onClose={() => setOpenTaskId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onDelete={() => {
            setOpenTaskId(null);
            return deleteTask(openTask.id);
          }}
          onArtifactsChanged={refresh}
          onCommentCountChange={(count) =>
            setItems((cur) => cur.map((t) => (t.id === openTask.id ? { ...t, commentCount: count } : t)))
          }
        />
      )}

      {creating && (
        <TaskModal
          projectId={projectId}
          options={options}
          allTasks={tasks}
          features={CORE_TASK_MODAL_FEATURES}
          canManage
          defaultStatus={createStatus}
          onClose={() => setCreating(false)}
          onCreate={(values) => createTask(values, () => setCreating(false))}
        />
      )}
    </div>
  );
}
