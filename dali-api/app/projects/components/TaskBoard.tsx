import { useCallback, useEffect, useMemo, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { Button } from "~/components/ui/Button";
import type { DragEndEvent } from "@dnd-kit/core";
import { Archive, Eye, EyeOff, Github, Paperclip, X } from "lucide-react";
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

// The `?epic=` filter value for tasks with no epic.
const NO_EPIC = "none";
// The `?term=` filter value that shows every term (opts out of the default
// current-term scoping).
const ALL_TERMS = "all";

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
}: Props) {
  // Optimistic board state + rollback live in the shared hook. Server data is
  // adopted whenever it changes and no save is in flight, so teammate edits,
  // GitHub webhook updates, and sprint rollovers appear without a manual
  // reload; our own mutations trigger a revalidation below to close the loop.
  const { items: tasks, move, error, setError, setItems } =
    useOptimisticBoardMove<TaskCardModel>(initialTasks);
  const [isCreating, setIsCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
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
    return ts;
  }, [tasks, epicFilter, sprintFilter, effectiveTerm, sprintTermById]);

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
        status: values.status,
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
        status: values.status,
        priority: values.priority,
        position: nextPositionInColumn(buildTaskBoard(cur), values.status),
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
        files: [],
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
    <div className="flex flex-col gap-3">
      <Confetti trigger={celebrate} onFire={() => setCelebrate(false)} />
      <div className="flex flex-wrap items-center gap-2">
        {termFilterEnabled && (
          <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium">Term</span>
            <select
              value={effectiveTerm}
              onChange={(e) => setTermFilter(e.target.value)}
              aria-label="Filter board by term"
              className="px-2 py-1 text-xs border border-border rounded-full bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            >
              {options.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                  {t.id === options.currentTermId ? " · current" : ""}
                </option>
              ))}
              <option value={ALL_TERMS}>All terms</option>
            </select>
          </label>
        )}
        {showEpicFilter && (
          <div
            className={`flex flex-wrap items-center gap-1.5 ${
              termFilterEnabled ? "pl-2 border-l border-border" : ""
            }`}
            role="group"
            aria-label="Filter by epic"
          >
            <FilterPill
              label="All"
              active={epicFilter === null}
              onClick={() => setEpicFilter(null)}
            />
            {visibleEpics.map((e) => (
              <FilterPill
                key={e.id}
                label={e.title}
                active={epicFilter === e.id}
                onClick={() => setEpicFilter(epicFilter === e.id ? null : e.id)}
              />
            ))}
            <FilterPill
              label="No epic"
              active={epicFilter === NO_EPIC}
              onClick={() => setEpicFilter(epicFilter === NO_EPIC ? null : NO_EPIC)}
            />
          </div>
        )}
        {epicSprints.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5 pl-2 border-l border-border"
            role="group"
            aria-label="Filter by sprint"
          >
            <FilterPill
              label="All sprints"
              active={sprintFilter === null}
              onClick={() => setParam("sprint", null)}
            />
            {epicSprints.map((s) => (
              <FilterPill
                key={s.id}
                label={s.name}
                active={sprintFilter === s.id}
                onClick={() => setParam("sprint", sprintFilter === s.id ? null : s.id)}
              />
            ))}
          </div>
        )}
        {(canManage || collapsibleEmptyCount > 0) && (
          <div className="flex items-center gap-2 ml-auto">
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
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-border text-muted-foreground hover:bg-muted/30 transition-colors"
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
                <Button variant="primary" size="sm" onClick={() => setIsCreating(true)}>
                  + Add task
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void runArchive()}
                  disabled={archiving}
                >
                  <Archive className="w-3.5 h-3.5" />
                  {archiving ? "Archiving…" : "Archive"}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setShowArchived(true)}>
                  <Archive className="w-3.5 h-3.5" />
                  Archived
                </Button>
              </>
            )}
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
          No archived tasks yet. Use Archive on the board to clear Done/Cancelled
          tasks now, or wait for the weekly auto-archive of idle ones.
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

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
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
      {label}
    </button>
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
      className={`border border-border rounded-md bg-background text-sm flex focus-within:ring-2 focus-within:ring-accent-coral/30 ${
        isDragging ? "opacity-40" : "hover:bg-muted/20"
      }`}
    >
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
        className="flex-1 min-w-0 text-left p-2.5 cursor-pointer focus:outline-none"
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
          {card.files.length > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
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
