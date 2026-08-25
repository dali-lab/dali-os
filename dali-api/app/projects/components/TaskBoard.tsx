import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import type { DragEndEvent } from "@dnd-kit/core";
import { Archive, Eye, EyeOff, Github, Paperclip, X } from "lucide-react";
import { Confetti } from "~/components/Confetti";
import { Modal } from "~/components/Modal";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { filterPillClass } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
import { ALL_TERMS, termFilterOrder } from "~/lib/terms.shared";
import {
  buildTaskBoard,
  moveTaskInBoard,
  nextPositionInColumn,
  isTaskStatus,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type TaskBoardOptions,
  taskMatchesQuery,
  type TaskCardModel,
  type TaskStatus,
} from "../lib/task-board";
import { SearchInput } from "~/components/ui/SearchInput";
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
  // Bumped by an outside control (the timeline's Add ▸ Task) to open the
  // create form. A counter rather than a boolean so repeated adds each fire.
  createNonce?: number;
};

// Card and list meta. 11px sits below the design's smallest step.
const META_TEXT = (os: boolean) => (os ? "text-xs" : "text-[11px]");

// The `?epic=` filter value for tasks with no epic.
const NO_EPIC = "none";
// The sprint select's "no filter" option. A Select needs a value for it; the
// URL keeps meaning "no sprint param at all".
const ALL_SPRINTS = "all";
// Same, for the epic select. `null` epicFilter means "every epic".
const ALL_EPICS = "all";

// The board's three filters are one set of controls, so they share a shape.
const FILTER_CONTROL = (os: boolean): string =>
  os
    ? filterPillClass(true)
    : "inline-flex items-center justify-between gap-1 px-2 py-1 text-xs border border-border rounded-full bg-background text-foreground transition-colors hover:bg-muted/40";

// Columns that may be collapsed away when empty via the "Hide empty" toggle.
// Deliberately only the low-traffic ends of the flow — hiding an empty
// active column (Todo/In progress/Done) would remove a drop target you
// actually drag into, whereas an empty Backlog/Cancelled is just wasted width.
const COLLAPSIBLE_EMPTY_STATUSES: TaskStatus[] = ["Backlog", "Cancelled"];
const HIDE_EMPTY_KEY = "taskboard:hideEmptyCols";

export function TaskBoard({
  projectId,
  initialTasks,
  options,
  canManage,
  currentUserId,
  currentUserName,
  createNonce = 0,
}: Props) {
  // Optimistic board state + rollback live in the shared hook. Server data is
  // adopted whenever it changes and no save is in flight, so teammate edits,
  // GitHub webhook updates, and sprint rollovers appear without a manual
  // reload; our own mutations trigger a revalidation below to close the loop.
  const { items: tasks, move, error, setError, setItems } =
    useOptimisticBoardMove<TaskCardModel>(initialTasks);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (createNonce > 0) setIsCreating(true);
  }, [createNonce]);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  // Board search. Deliberately component state, not a `?q=` param like the
  // epic/sprint/term filters: those are shareable slices set by a click, while
  // this changes on every keystroke — and a search-param change revalidates the
  // project loader, so `?q=` would refetch the whole board per character.
  const { os } = useOsChrome();
  const [query, setQuery] = useState("");
  // View density preference (per-browser, not shared): collapse empty
  // Backlog/Cancelled columns so they stop eating horizontal space. Defaults
  // to on; a toggle reveals them and the choice persists in localStorage.
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

  // Archive every live Done/Cancelled task on this project immediately
  // (the weekly job still uses the idle-day threshold lab-wide).
  const runArchive = useCallback(async () => {
    if (archiving) return;
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
  }, [archiving, projectId, refresh, setError]);

  // The open task is tracked in the URL (`?task=<id>`) so GitHub issue mirrors
  // and other external links can deep-link straight to a task. The sprint
  // filter lives in `?sprint=` for the same reason (shareable board slices).
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get("task");
  const epicFilter = searchParams.get("epic");
  const sprintFilter = searchParams.get("sprint");
  const termParam = searchParams.get("term");

  // The term filter only makes sense once the project spans more than one term
  // (its options are the project's terms + any term a sprint lands in). With
  // one term there's nothing to slice between, so it's hidden and the board
  // shows everything.
  const termFilterEnabled = options.terms.length >= 2;
  // Effective term: an explicit `?term=` wins; otherwise default to the lab's
  // current term when the project runs it (the whole point — open the board on
  // this term's work, not the full multi-term backlog). `all` opts out.
  const effectiveTerm = useMemo(() => {
    if (!termFilterEnabled) return ALL_TERMS;
    if (termParam === ALL_TERMS) return ALL_TERMS;
    if (termParam && options.terms.some((t) => t.id === termParam)) {
      return termParam;
    }
    return options.currentTermId ?? ALL_TERMS;
  }, [termFilterEnabled, termParam, options.terms, options.currentTermId]);

  const sprintTermById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const s of options.sprints) m.set(s.id, s.termId);
    return m;
  }, [options.sprints]);

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
  // Picking an epic resets the sprint sub-filter (its sprints are epic-scoped).
  const setEpicFilter = useCallback(
    (value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("epic", value);
          else next.delete("epic");
          next.delete("sprint");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );
  // Changing term drops the sprint sub-filter (a sprint from another term
  // would otherwise leave the board empty) — the epic filter stays put; its
  // pill is kept visible below even when pruned so it can still be cleared.
  const setTermFilter = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("term", value);
          next.delete("sprint");
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

  // Sprint sub-filter only applies within a concrete epic; its options are that
  // epic's sprints, scoped to the selected term so the sub-pills never offer a
  // sprint that the term filter would then hide.
  const epicSprints = useMemo(
    () =>
      epicFilter && epicFilter !== NO_EPIC
        ? options.sprints.filter(
            (s) =>
              s.epicId === epicFilter &&
              (effectiveTerm === ALL_TERMS || s.termId === effectiveTerm),
          )
        : [],
    [options.sprints, epicFilter, effectiveTerm],
  );

  // Epic pills for the selected term: an epic shows only if it has work in the
  // term (its termIds cover it). The currently-selected epic is always kept so
  // it stays deselectable even when it has nothing in this term.
  const visibleEpics = useMemo(
    () =>
      effectiveTerm === ALL_TERMS
        ? options.epics
        : options.epics.filter(
            (e) => e.termIds.includes(effectiveTerm) || e.id === epicFilter,
          ),
    [options.epics, effectiveTerm, epicFilter],
  );

  const filteredTasks = useMemo(() => {
    let ts = tasks;
    if (epicFilter === NO_EPIC) ts = ts.filter((t) => t.epicId === null);
    else if (epicFilter) ts = ts.filter((t) => t.epicId === epicFilter);
    if (sprintFilter) ts = ts.filter((t) => t.sprintId === sprintFilter);
    if (effectiveTerm !== ALL_TERMS) {
      ts = ts.filter((t) =>
        // Backlog (no sprint) is term-less — always visible so it stays the
        // pool you plan the term from. A sprinted task shows only if its
        // sprint resolves to the selected term.
        t.sprintId === null
          ? true
          : sprintTermById.get(t.sprintId) === effectiveTerm,
      );
    }
    if (query.trim()) ts = ts.filter((t) => taskMatchesQuery(t, query));
    return ts;
  }, [tasks, epicFilter, sprintFilter, effectiveTerm, sprintTermById, query]);

  const board = useMemo(() => buildTaskBoard(filteredTasks), [filteredTasks]);
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;

  // Clear the unread dot the moment a task is opened: optimistically locally
  // (so it disappears from the board immediately) and on the server (so it
  // stays cleared on the next load). Keyed on id alone so re-renders from
  // unrelated patches to the same open task don't re-fire the request.
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
          if ("status" in patch) body.status = patch.status;
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
      // Dropped on the column shell: append. On the card's own column that's
      // no reorder intent at all — bail.
      if (toStatus === fromStatus) return;
      targetIndex = -1;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask || overTask.id === taskId) return;
      toStatus = overTask.status;
      // The over card's index in the FULL column, even when a sprint filter
      // is active: inserting at the target's global position preserves hidden
      // tasks' relative order while landing where the user sees.
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

  // Create from the modal. The POST endpoint applies title/status/dates/
  // sprint/epic/story; domain/assignees are applied with a follow-up
  // PATCH via the same optimistic path the card edits use.
  async function handleCreate(values: NewTaskValues) {
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
        sprintId: values.sprintId,
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
        // Server-owned since the modal stopped offering the field: the create
        // endpoint applies the column default, and this mirrors it optimistically.
        priority: "Normal",
        position: nextPositionInColumn(buildTaskBoard(cur), values.status),
        dueAt: values.dueAt,
        startsAt: values.startsAt,
        epicId: values.epicId,
        sprintId: values.sprintId,
        storyId: values.storyId,
        checklist: values.checklist ?? null,
        assignees,
        domain,
        // The GH issue is filed async after we ack; the link surfaces on the
        // next revalidation. Null here means no badge in the meantime.
        githubIssueUrl: null,
        githubIssueNumber: null,
        files: [],
        createdBy: { id: currentUserId, name: currentUserName },
        createdAt: new Date().toISOString(),
        hasUnread: false,
      },
    ]);
    setIsCreating(false);

    // Push the fields the create endpoint doesn't accept. patchTask owns its
    // own optimistic update + rollback, so the card already reflects them.
    const patch: Partial<TaskCardModel> = {};
    if (domain) patch.domain = domain;
    if (assignees.length > 0) patch.assignees = assignees;
    if (Object.keys(patch).length > 0) {
      await patchTask(id, patch);
    } else {
      refresh();
    }
  }

  // How many collapsible columns are currently empty (drives the toggle's
  // visibility + its "Show empty (N)" count). Uses the filtered board so it
  // reflects what's actually on screen under the active epic/sprint/term slice.
  const collapsibleEmptyCount = COLLAPSIBLE_EMPTY_STATUSES.filter(
    (s) => (board[s]?.length ?? 0) === 0,
  ).length;

  const columns: KanbanColumn<TaskCardModel>[] = TASK_STATUSES.filter(
    (status) =>
      !(
        hideEmptyCols &&
        COLLAPSIBLE_EMPTY_STATUSES.includes(status) &&
        (board[status]?.length ?? 0) === 0
      ),
  ).map((status) => ({
    id: status,
    title: TASK_STATUS_LABELS[status],
    cards: board[status] ?? [],
    // The status columns keep the original taller drop zone.
    listClassName: "flex flex-col gap-2 p-2 min-h-[360px]",
  }));

  // Epic pills slice the board to one epic's tasks, plus "No epic" for tasks
  // that aren't in any epic. Under a term filter the pill set is pruned to
  // epics with work in that term.
  const showEpicFilter = visibleEpics.length > 0;

  return (
    <div className={cn("flex flex-col", os ? "gap-4" : "gap-3")}>
      <Confetti trigger={celebrate} onFire={() => setCelebrate(false)} />
      <div className={cn("flex min-w-0 items-center", os ? "gap-3" : "gap-2")}>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks on this board"
          containerClassName={cn("shrink-0", os ? "w-56 sm:w-72" : "w-44 sm:w-56")}
        />
        {termFilterEnabled && (
          <label
            className={cn(
              "inline-flex shrink-0 items-center gap-2 text-muted-foreground",
              os ? "text-sm" : "text-xs",
            )}
          >
            <span className="font-medium">Term</span>
            <Select
              value={effectiveTerm}
              // Shared ordering/labelling ("All terms" first, current term
              // marked "· current"); kept as a bare Select rather than
              // <TermFilter> so setTermFilter can also clear the sprint sub-filter.
              options={termFilterOrder(
                options.terms.map((t) => ({
                  id: t.id,
                  code: t.code,
                  isCurrent: t.id === options.currentTermId,
                })),
              )}
              ariaLabel="Filter board by term"
              buttonClassName={FILTER_CONTROL(os)}
              onChange={(value) => setTermFilter(value)}
            />
          </label>
        )}
        {showEpicFilter && (
          <Select
            value={epicFilter ?? ALL_EPICS}
            options={[
              { value: ALL_EPICS, label: "All epics" },
              ...visibleEpics.map((e) => ({ value: e.id, label: e.title })),
              { value: NO_EPIC, label: "No epic" },
            ]}
            ariaLabel="Filter board by epic"
            buttonClassName={FILTER_CONTROL(os)}
            onChange={(value) => setEpicFilter(value === ALL_EPICS ? null : value)}
          />
        )}
        {epicSprints.length > 0 && (
          <Select
            value={sprintFilter ?? ALL_SPRINTS}
            options={[
              { value: ALL_SPRINTS, label: "All sprints" },
              ...epicSprints.map((s) => ({ value: s.id, label: s.name })),
            ]}
            ariaLabel="Filter board by sprint"
            buttonClassName={FILTER_CONTROL(os)}
            onChange={(value) => setParam("sprint", value === ALL_SPRINTS ? null : value)}
          />
        )}
        {(canManage || collapsibleEmptyCount > 0) && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {collapsibleEmptyCount > 0 && (
              <button
                type="button"
                onClick={toggleHideEmpty}
                aria-pressed={hideEmptyCols}
                title={
                  hideEmptyCols
                    ? "Show empty Backlog / Cancelled columns"
                    : "Hide empty Backlog / Cancelled columns"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border transition-colors",
                  os
                    ? "border-border px-4 py-2 text-sm text-os-grey hover:bg-os-container hover:text-foreground"
                    : "border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/30",
                )}
              >
                {hideEmptyCols ? (
                  <Eye className="w-3.5 h-3.5" aria-hidden />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden />
                )}
                {hideEmptyCols ? `Show empty (${collapsibleEmptyCount})` : "Hide empty"}
              </button>
            )}
            {canManage && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void runArchive()}
                  disabled={archiving}
                >
                  <Archive className="w-3.5 h-3.5" />
                  {archiving ? "Archiving…" : "Archive"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowArchived(true)}
                >
                  <Archive className="w-3.5 h-3.5" />
                  Archived
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {query.trim() && filteredTasks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No tasks match &ldquo;{query.trim()}&rdquo;.
        </p>
      )}

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
          projectId={projectId}
          options={options}
          canManage={canManage}
          onClose={() => setOpenTaskId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onDelete={() => deleteTask(openTask.id)}
          onArtifactsChanged={refresh}
        />
      )}

      {isCreating && (
        <TaskModal
          projectId={projectId}
          options={options}
          canManage={canManage}
          defaultEpicId={
            epicFilter && epicFilter !== NO_EPIC ? epicFilter : null
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
  const { os } = useOsChrome();
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
      containerClassName={cn(
        modalCardClass(os, "max-w-xl max-h-[80vh]"),
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
      {!error && tasks === null && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {tasks !== null && tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No archived tasks yet. Use Archive on the board to clear Done/Cancelled
          tasks now, or wait for the weekly auto-archive of idle ones.
        </p>
      )}

      {tasks !== null && tasks.length > 0 && (
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
    </Modal>
  );
}

// The whole card — title included — is the drag source: the KanbanBoard
// pointer sensor's activation distance disambiguates click from drag, so a
// press-and-release still opens the modal while a press-and-move starts a
// drag. Card text is deliberately not selectable (Trello/Linear behavior);
// copy the title from the modal, where it's an input. Keyboard activation
// (Enter/Space) also opens the modal so the card stays operable without a
// pointer.
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
  const { os } = useOsChrome();
  const overdue =
    card.dueAt != null &&
    card.status !== "Done" &&
    card.status !== "Cancelled" &&
    new Date(card.dueAt).getTime() < Date.now();

  const checklist = Array.isArray(card.checklist) ? card.checklist : null;
  const checklistDone = checklist?.filter((i) => i.done).length ?? 0;

  return (
    <div
      {...dragHandleProps}
      data-testid="task-card"
      className={cn(
        "relative border flex focus-within:ring-2",
        os
          ? "rounded-os-item border-transparent bg-os-well text-[15px] focus-within:ring-os-accent/40"
          : "rounded-md border-border bg-background text-sm focus-within:ring-accent-coral/30",
        isDragging ? "opacity-40" : os ? "hover:bg-os-container/60" : "hover:bg-muted/20",
      )}
    >
      {card.hasUnread && (
        <span
          className={cn(
            "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2",
            os ? "bg-os-accent ring-os-card" : "bg-accent-coral ring-background",
          )}
          title="New updates since you last opened this task"
          aria-label="New updates since you last opened this task"
        />
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "flex-1 min-w-0 text-left cursor-pointer focus:outline-none",
          os ? "p-3" : "p-2.5",
        )}
      >
        <div className="text-foreground">{card.title}</div>
        {card.assignees.length > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className={cn(META_TEXT(os), "text-muted-foreground truncate")}>
              {card.assignees.map((a) => a.name).join(", ")}
            </span>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.dueAt && (
            <span
              className={cn(
                META_TEXT(os),
                "px-1.5 py-0.5 border",
                os ? "rounded-full" : "rounded-md",
                overdue
                  ? os
                    ? "border-transparent bg-os-amber/20 text-os-amber"
                    : "border-accent-coral/40 text-accent-coral bg-accent-coral/10"
                  : os
                    ? "border-transparent bg-os-container text-os-grey"
                    : "border-border text-muted-foreground",
              )}
            >
              Due {formatDuePill(card.dueAt)}
            </span>
          )}
          {card.domain && (
            <span
              className={cn(
                META_TEXT(os),
                "px-1.5 py-0.5 border",
                os
                  ? "rounded-full border-transparent bg-os-accent/15 text-os-accent"
                  : "rounded-md bg-blue-50 text-blue-700 border-blue-100",
              )}
            >
              {card.domain.name}
            </span>
          )}
          {checklist && checklist.length > 0 && (
            <span
              className={cn(
                META_TEXT(os),
                "px-1.5 py-0.5 border text-muted-foreground",
                os ? "rounded-full border-transparent bg-os-container" : "rounded-md border-border",
              )}
            >
              {checklistDone}/{checklist.length}
            </span>
          )}
          {card.githubIssueNumber !== null && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-muted-foreground",
                META_TEXT(os),
              )}
            >
              <Github aria-hidden className="w-3 h-3" />#{card.githubIssueNumber}
            </span>
          )}
          {card.files.length > 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-muted-foreground",
                META_TEXT(os),
              )}
            >
              <Paperclip aria-hidden className="w-3 h-3" />
              {card.files.length}
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
