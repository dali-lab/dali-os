import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { Menu, MenuItem, Popover, Tooltip, InfoTip } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  Archive,
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Confetti } from "~/components/Confetti";
import { Modal } from "~/components/Modal";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import {
  FilterCountBadge,
  FilterGroup,
  FilterPill,
  FilterResetButton,
  FilterSectionLabel,
  customizeButtonClass,
  filterPanelClass,
} from "~/components/ui/filter-panel";
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
import { PeopleFilter, type PersonOption } from "./PeopleFilter";
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
  // The board's people filter (os). Rendered beside the search input and
  // applied only to the board's tasks. Empty = no people filter; the board's
  // own filters (epic/sprint/term/mine/search) still apply on top.
  filterPeopleIds?: string[];
  // People who hold tasks on this project — the filter's options. Empty (or no
  // onPeopleChange) hides the control.
  peopleOptions?: PersonOption[];
  onPeopleChange?: (ids: string[]) => void;
};

// Card and list meta. 11px sits below the design's smallest step.
const META_TEXT = (os: boolean) => (os ? "text-xs" : "text-[11px]");

// The `?epic=` filter value for tasks with no epic.
const NO_EPIC = "none";
// Each status owns a hue. The column header wears it as a solid bar and the
// card carries it on its left edge, so a card still reads as belonging to its
// column once it's dragged out of one. Brand palette, not the reference's —
// the board's surfaces, borders and radii are unchanged.
// Status colour. The os shell reads it from app.css rather than from utility
// classes: a tint that works over the dark ground is a wash over light mode's
// paper, and only a variable can say "tint here, solid there" — the same split
// the timeline's level plates make. Values, and the reasoning, live beside
// those plates in app.css.
//
// `fill`/`ink` dress the column header; `edge` is the hue at full strength for
// the card's left border, which the dark tint is too faint to draw. They're
// CSS values rather than classes because app.css closes with an unlayered
// `* { border-color: var(--color-border) }` that outranks every border-colour
// utility Tailwind emits — an inline style is what beats it.
type StatusAccent = { fill: string; ink: string; edge: string };

const osToken = (name: string): StatusAccent => ({
  fill: `var(--os-status-${name}-fill)`,
  ink: `var(--os-status-${name}-ink)`,
  edge: `var(--os-status-${name}-edge)`,
});

const STATUS_ACCENT_OS: Record<TaskStatus, StatusAccent> = {
  Backlog: osToken("backlog"),
  Todo: osToken("todo"),
  InProgress: osToken("progress"),
  InReview: osToken("review"),
  Done: osToken("done"),
  Cancelled: osToken("cancelled"),
};

// The classic shell keeps its own light-only treatment — it has no dark ground
// to tint against, so the soft fill it always used still reads.
const STATUS_ACCENT_CLASSIC: Record<TaskStatus, StatusAccent> = {
  Backlog: {
    fill: "var(--color-muted)",
    ink: "var(--color-foreground)",
    edge: "var(--color-brand-gray)",
  },
  // Violet, not the brand coral: coral is the classic shell's primary action
  // and its avatar fallback, so spending it on a column too made the board
  // read as one wash of pink. It's also the hue the timeline gives an epic,
  // which keeps the two views on one set.
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

const statusAccent = (status: TaskStatus, os: boolean): StatusAccent =>
  (os ? STATUS_ACCENT_OS : STATUS_ACCENT_CLASSIC)[status];

// Columns that may be collapsed away when empty via the "Hide empty" toggle.
// Deliberately only the low-traffic ends of the flow — hiding an empty
// active column (Todo/In progress/Done) would remove a drop target you
// actually drag into, whereas an empty Backlog/Cancelled is just wasted width.
const COLLAPSIBLE_EMPTY_STATUSES: TaskStatus[] = ["Backlog", "Cancelled"];
const HIDE_EMPTY_KEY = "taskboard:hideEmptyCols";
// Columns the viewer has folded to a spine via the column menu. Per-browser,
// like the hide-empty preference — a board layout choice, not a shared one.
const COLLAPSED_KEY = "taskboard:collapsedCols";

export function TaskBoard({
  projectId,
  initialTasks,
  options,
  canManage,
  currentUserId,
  currentUserName,
  createNonce = 0,
  filterPeopleIds = [],
  peopleOptions = [],
  onPeopleChange,
}: Props) {
  // Optimistic board state + rollback live in the shared hook. Server data is
  // adopted whenever it changes and no save is in flight, so teammate edits,
  // GitHub webhook updates, and sprint rollovers appear without a manual
  // reload; our own mutations trigger a revalidation below to close the loop.
  const { items: tasks, move, error, setError, setItems } =
    useOptimisticBoardMove<TaskCardModel>(initialTasks);
  const [isCreating, setIsCreating] = useState(false);
  // Which column the open create form was launched from — its "Add task"
  // seeds the modal's status so the card lands where you asked for it.
  const [createStatus, setCreateStatus] = useState<TaskStatus>("Todo");

  useEffect(() => {
    if (createNonce > 0) {
      setCreateStatus("Todo");
      setIsCreating(true);
    }
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
  // Columns folded to a spine from their own ⋯ menu. A collapsed column stays
  // a drop target (dropping on the spine appends to it) — it just stops
  // spending width on cards you're not working in.
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
  // "Only my tasks" is a filter like the others, so it lives in the URL too —
  // a board sliced to one person is a link worth sending.
  const onlyMine = searchParams.get("mine") === "1";

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
    if (onlyMine) {
      ts = ts.filter((t) => t.assignees.some((a) => a.id === currentUserId));
    }
    if (filterPeopleIds.length > 0) {
      const want = new Set(filterPeopleIds);
      ts = ts.filter((t) => t.assignees.some((a) => want.has(a.id)));
    }
    if (query.trim()) ts = ts.filter((t) => taskMatchesQuery(t, query));
    return ts;
  }, [
    tasks,
    epicFilter,
    sprintFilter,
    effectiveTerm,
    sprintTermById,
    onlyMine,
    currentUserId,
    filterPeopleIds,
    query,
  ]);

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
        commentCount: 0,
        createdBy: { id: currentUserId, name: currentUserName },
        createdAt: new Date().toISOString(),
        activityAt: new Date().toISOString(),
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

  const startCreate = useCallback((status: TaskStatus) => {
    setCreateStatus(status);
    setIsCreating(true);
  }, []);

  const columns: KanbanColumn<TaskCardModel>[] = TASK_STATUSES.filter(
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
    // No overflow-hidden: the header rounds its own top corners, and clipping
    // the shell would cut the unread dot off the corner of a card.
    const shell = os
      ? "flex-shrink-0 border border-transparent rounded-os-item bg-os-card flex flex-col"
      : "flex-shrink-0 border rounded-lg border-border bg-card flex flex-col";

    if (collapsed) {
      return {
        id: status,
        title: null,
        // A spine: the column's colour, its name turned on its side, and its
        // count — enough to aim a drag at without spending a column's width.
        className: cn(shell, "w-11"),
        headerClassName: cn("flex items-center justify-center px-1 py-2", roundedTop),
        headerStyle: { background: accent.fill, color: accent.ink },
        headerExtra: (
          <Tooltip content={`Expand ${label}`}>
            <button
              type="button"
              onClick={() => toggleCollapsed(status)}
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
            onClick={() => toggleCollapsed(status)}
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
      // The title carries the band's ink itself: BoardColumn puts
      // `text-foreground` on its title slot, which would otherwise win over
      // the colour inherited from the header.
      title: <span style={{ color: accent.ink }}>{label}</span>,
      className: cn(shell, "w-64"),
      headerClassName: cn(
        "flex items-center justify-between gap-2 px-3 py-2",
        roundedTop,
      ),
      headerStyle: { background: accent.fill, color: accent.ink },
      headerExtra: (
        <div className="flex shrink-0 items-center gap-1 text-current">
          <span
            className={cn(
              "rounded-full border border-current/30 px-2 py-0.5 font-medium tabular-nums",
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
                onSelect={() => startCreate(status)}
              >
                Add task
              </MenuItem>
            )}
            <MenuItem
              icon={<ChevronsLeft className="h-4 w-4" aria-hidden />}
              onSelect={() => toggleCollapsed(status)}
            >
              Collapse column
            </MenuItem>
          </Menu>
        </div>
      ),
      cards,
      // The status columns keep the original taller drop zone, but cap their
      // height and scroll within it so a column with dozens of tasks can't
      // stretch the whole hub taller than the viewport. Mirrors StaffingBoard.
      listClassName:
        "flex flex-col gap-2 p-2 min-h-[360px] max-h-[calc(100vh-14rem)] overflow-y-auto",
      listHeader: canManage ? (
        <button
          type="button"
          onClick={() => startCreate(status)}
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

  // The epic control only earns its place when the project has epics to slice
  // by. Under a term filter the option set is pruned to epics with work in it.
  const showEpicFilter = visibleEpics.length > 0;

  // What the Customize badge counts: every active slice bar the search box,
  // which has its own visible field. The term filter counts only when it isn't
  // sitting on its default (this term, or All when the project doesn't run it).
  const defaultTerm = options.currentTermId ?? ALL_TERMS;
  const activeFilterCount =
    (epicFilter ? 1 : 0) +
    (sprintFilter ? 1 : 0) +
    (onlyMine ? 1 : 0) +
    (termFilterEnabled && effectiveTerm !== defaultTerm ? 1 : 0);

  // Option lists for the two comboboxes. `null` is the "no filter" row in
  // both, and leads so it's the first thing an empty query offers.
  const epicOptions: ComboOption[] = useMemo(
    () => [
      { value: null, label: "All epics" },
      ...visibleEpics.map((e) => ({ value: e.id as string | null, label: e.title })),
      { value: NO_EPIC as string | null, label: "No epic" },
    ],
    [visibleEpics],
  );
  const sprintOptions: ComboOption[] = useMemo(
    () => [
      { value: null, label: "All sprints" },
      ...epicSprints.map((sp) => ({ value: sp.id as string | null, label: sp.name })),
    ],
    [epicSprints],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ["epic", "sprint", "term", "mine"]) next.delete(key);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [setSearchParams]);

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

        {/* People filter sits right next to search — it slices the board's
            tasks to the chosen assignees, alongside the search box. os only:
            the control is styled for the os shell and the timeline is where the
            options come from. */}
        {os && onPeopleChange && peopleOptions.length > 0 && (
          <PeopleFilter
            options={peopleOptions}
            selected={filterPeopleIds}
            onChange={onPeopleChange}
          />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Every slice lives behind this one control. The filters used to sit
              in the toolbar as a row of selects that grew with the project;
              folding them into a panel keeps the board's own width for the
              board, and the badge says how many are on so a filtered board is
              never silently filtered. */}
          <Popover
            align="right"
            ariaLabel="Customize board"
            panelClassName={filterPanelClass(os)}
            trigger={
              <button
                type="button"
                className={customizeButtonClass(os, activeFilterCount > 0)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                Customize
                <FilterCountBadge os={os} count={activeFilterCount} />
              </button>
            }
          >
            <div className="flex flex-col gap-4">
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <FilterSectionLabel os={os}>Filters</FilterSectionLabel>
                  {activeFilterCount > 0 && (
                    <FilterResetButton os={os} onClick={resetFilters} />
                  )}
                </div>

                {termFilterEnabled && (
                  <div className="flex flex-col gap-1.5">
                    <span className={cn("text-xs inline-flex items-center gap-1", os ? "text-os-grey" : "text-muted-foreground")}>
                      Term
                      <InfoTip
                        content="Term code format: last two digits of the year + S (spring), F (fall), or X (summer). E.g. 26F = Fall 2026."
                        placement="right"
                      />
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {termFilterOrder(
                        options.terms.map((t) => ({
                          id: t.id,
                          code: t.code,
                          isCurrent: t.id === options.currentTermId,
                        })),
                      ).map((opt) => (
                        <FilterPill
                          key={opt.value}
                          os={os}
                          selected={effectiveTerm === opt.value}
                          onClick={() => setTermFilter(opt.value)}
                        >
                          {opt.label}
                        </FilterPill>
                      ))}
                    </div>
                  </div>
                )}

                {showEpicFilter && (
                  <FilterCombobox
                    id="taskboard-epic-options"
                    label="Epic"
                    ariaLabel="Filter board by epic"
                    placeholder="Search epics…"
                    os={os}
                    options={epicOptions}
                    value={epicFilter}
                    onChange={setEpicFilter}
                  />
                )}

                {epicSprints.length > 0 && (
                  <FilterCombobox
                    id="taskboard-sprint-options"
                    label="Sprint"
                    ariaLabel="Filter board by sprint"
                    placeholder="Search sprints…"
                    os={os}
                    options={sprintOptions}
                    value={sprintFilter}
                    onChange={(next) => setParam("sprint", next)}
                  />
                )}

                <Toggle
                  label="Only my tasks"
                  checked={onlyMine}
                  onChange={(e) => setParam("mine", e.target.checked ? "1" : null)}
                />
              </section>

              <section
                className={cn(
                  "flex flex-col gap-3 border-t pt-3",
                  os ? "border-os-container" : "border-border",
                )}
              >
                <FilterSectionLabel os={os}>Layout</FilterSectionLabel>
                <Toggle
                  label="Hide empty Backlog / Cancelled"
                  checked={hideEmptyCols}
                  onChange={toggleHideEmpty}
                />
                {collapsedCols.length > 0 && (
                  <button
                    type="button"
                    onClick={() => persistCollapsed([])}
                    className={cn(
                      "self-start text-xs underline-offset-2 hover:underline",
                      os ? "text-os-accent" : "text-accent-coral",
                    )}
                  >
                    Expand {collapsedCols.length} collapsed column
                    {collapsedCols.length === 1 ? "" : "s"}
                  </button>
                )}
              </section>
            </div>
          </Popover>

          {canManage && (
            <Menu
              align="right"
              ariaLabel="Board actions"
              trigger={
                <button
                  type="button"
                  aria-label="Board actions"
                  className={
                    os
                      ? "os-icon-btn"
                      : "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                </button>
              }
            >
              <MenuItem
                icon={<Archive className="h-4 w-4" aria-hidden />}
                onSelect={() => void runArchive()}
                disabled={archiving}
              >
                {archiving ? "Archiving…" : "Archive Done & Cancelled"}
              </MenuItem>
              <MenuItem
                icon={<Archive className="h-4 w-4" aria-hidden />}
                onSelect={() => setShowArchived(true)}
              >
                View archived tasks
              </MenuItem>
            </Menu>
          )}
        </div>
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
        dropPlaceholder
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
          defaultStatus={createStatus}
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

// ── Customize panel furniture ────────────────────────────────────────────
// The filters are pills rather than <Select>s on purpose: the panel is itself
// a floating layer, and a select's own portaled listbox counts as an outside
// press against it — picking an option would dismiss the panel it was picked
// in. Pills also let the whole slice be read at a glance, which is the point
// of collecting the filters in one place.

// A pill per option stops working once a project has more than a handful of
// epics (or a long-running epic more than a handful of sprints) — the panel
// turns into a wall you have to read — so both are type-to-filter comboboxes.
//
// Hand-rolled rather than <Select>: the panel it sits in is itself a floating
// layer, and a portaled listbox counts as an outside press against it, so
// choosing an option would dismiss the panel it was chosen in. For the same
// reason the list is in flow rather than floating — the panel is a scroll
// container and would clip it.
export type ComboOption = { value: string | null; label: string };

function FilterCombobox({
  label,
  os,
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
  id,
}: {
  label: string;
  os: boolean;
  options: ComboOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder: string;
  ariaLabel: string;
  /** Unique per mounted combobox — the listbox and its rows are keyed off it. */
  id: string;
}) {
  const selectedLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // A stale index from the previous query would highlight the wrong row (or
  // none), so every narrowing puts the cursor back on the first match.
  useEffect(() => setActiveIndex(0), [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const commit = (next: string | null) => {
    onChange(next);
    close();
  };

  return (
    <div
      className="flex flex-col gap-1.5"
      // Blur is scoped to the whole control, not the input: closing on the
      // input's own blur meant a press anywhere in the list — its padding, the
      // gap between rows, the scrollbar — tore the list down mid-click, which
      // is what read as the field flickering.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <span className={cn("text-xs", os ? "text-os-grey" : "text-muted-foreground")}>
        {label}
      </span>
      <div>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={id}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          aria-activedescendant={open && matches[activeIndex] ? `${id}-${activeIndex}` : undefined}
          value={open ? query : selectedLabel}
          placeholder={placeholder}
          // Opened by an actual press, not by focus: the panel moves focus to
          // its first control when it opens, and opening on focus meant the
          // list unfurled on its own the moment you hit Customize.
          onMouseDown={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) return setOpen(true);
              setActiveIndex((i) => {
                const n = matches.length;
                if (n === 0) return 0;
                return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
              });
            } else if (e.key === "Enter") {
              if (!open || !matches[activeIndex]) return;
              e.preventDefault();
              commit(matches[activeIndex].value);
            } else if (e.key === "Escape" && open) {
              // Close the list, not the whole Customize panel behind it.
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          className={cn(
            "w-full rounded-full border px-3 py-1.5 text-xs transition-colors focus:outline-none",
            os
              ? "border-os-container bg-os-well text-foreground placeholder:text-os-muted focus:border-os-accent"
              : "border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-accent-coral",
          )}
        />
        {open && (
          <ul
            id={id}
            role="listbox"
            // Nothing inside the list should move focus off the input — a blur
            // and re-focus between mousedown and click is exactly the flicker.
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "mt-1 max-h-40 w-full overflow-y-auto rounded-lg border p-1",
              os ? "border-os-container bg-os-well" : "border-border bg-background",
            )}
          >
            {matches.length === 0 && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">
                Nothing matches &ldquo;{query.trim()}&rdquo;.
              </li>
            )}
            {matches.map((o, i) => (
              <li key={o.value ?? "__all"}>
                <button
                  type="button"
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  tabIndex={-1}
                  onClick={() => commit(o.value)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "block w-full truncate rounded px-2 py-1.5 text-left text-xs transition-colors",
                    i === activeIndex && (os ? "bg-os-container" : "bg-muted"),
                    o.value === value
                      ? os
                        ? "text-os-accent"
                        : "text-accent-coral"
                      : "text-foreground",
                  )}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
  const dateRange = formatDateRange(card.startsAt, card.dueAt);

  return (
    <div
      {...dragHandleProps}
      data-testid="task-card"
      style={{ borderLeftColor: statusAccent(card.status, os).edge }}
      className={cn(
        "relative border border-l-4 flex focus-within:ring-2",
        os
          ? "rounded-os-item border-transparent bg-os-well text-[15px] focus-within:ring-os-accent/40"
          : "rounded-md border-border bg-background text-sm focus-within:ring-accent-coral/30",
        isDragging ? "opacity-40" : os ? "hover:bg-os-container/60" : "hover:bg-muted/20",
      )}
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
        className={cn(
          "flex-1 min-w-0 text-left cursor-pointer focus:outline-none",
          os ? "p-3" : "p-2.5",
        )}
      >
        {/* Title line — a bell ahead of the name when the task has moved on
            since you last opened it (a field or description edit, a comment,
            an attached file, a GitHub link: anything that stamps activityAt). */}
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
                  os ? "text-os-accent" : "text-accent-coral",
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

        {/* Counts and dates, each an icon beside its value. */}
        <div
          className={cn(
            "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-muted-foreground",
            META_TEXT(os),
          )}
        >
          {/* Overdue tints the icon, not the date. Recolouring the text made
              the one meta item you always read sit in a different ink from the
              counts beside it, so the row read as broken rather than as a
              warning — and on a card whose dates are simply set, that colour
              had no meaning at all. */}
          {dateRange && (
            <MetaItem
              icon={
                <CalendarDays
                  aria-hidden
                  className={cn(
                    "w-3.5 h-3.5",
                    overdue && (os ? "text-os-amber" : "text-accent-coral"),
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
        </div>
      </div>
    </div>
  );
}

// One fact on the card's bottom line: an icon and its value, nothing else.
// Borderless on purpose — a row of bordered pills competes with the title,
// and these are counts, not labels.
function MetaItem({
  icon,
  title,
  className,
  children,
}: {
  icon: ReactNode;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={title ?? null}>
      <span className={cn("inline-flex items-center gap-1", className)}>
        {icon}
        {children}
      </span>
    </Tooltip>
  );
}

// The card's date line. A task with both bounds shows its span ("Sep 1 –
// Sep 30"); one bound names which end it is, so a start-only task doesn't
// read as a deadline.
function formatDateRange(startsAt: string | null, dueAt: string | null): string | null {
  if (startsAt && dueAt) return `${formatDuePill(startsAt)} – ${formatDuePill(dueAt)}`;
  if (dueAt) return `Due ${formatDuePill(dueAt)}`;
  if (startsAt) return `Start ${formatDuePill(startsAt)}`;
  return null;
}

// Compact age for the "Updated" chip — "3h", "2d", "5w". Anything older than
// a year is just "1y+"; the exact stamp is in the chip's title.
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
