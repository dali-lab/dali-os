import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDialog } from "~/components/ui/dialog";
import { useRevalidator, useSearchParams } from "react-router";
import { Menu, MenuItem, Popover, Select, Tooltip, InfoTip } from "~/components/ui/floating";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  Archive,
  ArrowRight,
  Bell,
  CheckSquare,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Link2,
  GitPullRequest,
  MessageSquare,
  RotateCw,
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
  FilterField,
  FilterGroup,
  FilterPill,
  FilterResetButton,
  FilterSectionLabel,
  FilterToggleRow,
  customizeButtonClass,
  filterPanelClass,
} from "~/components/ui/filter-panel";
import { cn } from "~/lib/cn";
import { useOptimisticBoardMove } from "~/components/board/useOptimisticBoardMove";
import {
  BOARD_STATUSES,
  buildTaskBoard,
  moveTaskInBoard,
  nextPositionInColumn,
  isTaskStatus,
  isTaskFinished,
  TASK_STATUS_LABELS,
  type TaskBoardOptions,
  taskMatchesQuery,
  type TaskCardModel,
  type TaskStatus,
} from "../lib/task-board";
import {
  defaultBoardSprint,
  sprintDays,
  sprintLabel,
  sprintRangeLabel,
  sprintStatus,
  type SprintModel,
} from "../lib/sprints";
import { localTodayUtcDay } from "../lib/timeline-days";
import { SprintAnchorControl } from "./SprintAnchorControl";
import { requiresMergedPr } from "../lib/code-tasks";
import { SearchInput } from "~/components/ui/SearchInput";
import { PeopleFilter, type PersonOption } from "./PeopleFilter";
import { TaskModal, type NewTaskValues } from "./TaskModal";

/** Context an outside Add task carries into the create form. */
export type TaskCreateSeed = {
  epicId: string | null;
  // The epic modal that closed to make room for this form, handed back when
  // the form closes. Null where the add covered nothing up.
  reopenEpicId?: string | null;
};

/** A card on a closed sprint's board, as it stood when the sprint closed. */
export type SnapshotCard = TaskCardModel & { carriedTo: string | null };

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
  // Set by an outside control (the planning timeline's Add ▸ Task, or a story
  // row's own Add task) to open the create form, carrying the epic/story the
  // request came from. The parent holds it in state and sets a fresh object per
  // request, so two adds on the same story still differ by reference and the
  // effect below fires for each — no counter needed.
  createSeed?: TaskCreateSeed | null;
  // Fires when a seeded create form closes, saved or dismissed, with the seed it
  // was opened from — the caller uses it to put back whatever it closed. Not
  // called for the board's own adds, which were opened from nothing.
  onCreateClosed?: (seed: TaskCreateSeed) => void;
  // The board's people filter (os). Rendered beside the search input and
  // applied only to the board's tasks. Empty = no people filter; the board's
  // own filters (epic/sprint/mine/search) still apply on top.
  filterPeopleIds?: string[];
  // People who hold tasks on this project — the filter's options. Empty (or no
  // onPeopleChange) hides the control.
  peopleOptions?: PersonOption[];
  onPeopleChange?: (ids: string[]) => void;
};

// Card and list meta. 11px sits below the design's smallest step.
const META_TEXT = (os: boolean) => (os ? "text-xs" : "text-[11px]");


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

const SHOW_CANCELLED_KEY = "taskboard:showCancelled";
// Columns the viewer has folded to a spine via the column menu. Per-browser.
const COLLAPSED_KEY = "taskboard:collapsedCols";

export function TaskBoard({
  projectId,
  initialTasks,
  options,
  canManage,
  currentUserId,
  currentUserName,
  createSeed = null,
  onCreateClosed,
  filterPeopleIds = [],
  peopleOptions = [],
  onPeopleChange,
}: Props) {
  // Optimistic board state + rollback live in the shared hook. Server data is
  // adopted whenever it changes and no save is in flight, so teammate edits,
  // GitHub webhook updates, and sprint rollovers appear without a manual
  // reload; our own mutations trigger a revalidation below to close the loop.
  const dialog = useDialog();
  const { items: tasks, move, error, setError, setItems } =
    useOptimisticBoardMove<TaskCardModel>(initialTasks);
  const [isCreating, setIsCreating] = useState(false);
  // Which column the open create form was launched from — its "Add task"
  // seeds the modal's status so the card lands where you asked for it.
  const [createStatus, setCreateStatus] = useState<TaskStatus>("Todo");
  // The epic/story the open create form was launched for (null when it came
  // from the board itself). Adopted from the createSeed prop below; cleared by
  // a column's own Add task so it can't inherit a story from an earlier add.
  // The state renders the form's seeded pickers; the ref is what closeCreate
  // reads, so closing is once-only regardless of render timing.
  const [createLinks, setCreateLinks] = useState<TaskCreateSeed | null>(null);
  const createLinksRef = useRef<TaskCreateSeed | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  // Board search. Deliberately component state, not a `?q=` param like the
  // epic/sprint/term filters: those are shareable slices set by a click, while
  // this changes on every keystroke — and a search-param change revalidates the
  // project loader, so `?q=` would refetch the whole board per character.
  const { os } = useOsChrome();
  const [query, setQuery] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  useEffect(() => {
    try {
      setShowCancelled(window.localStorage.getItem(SHOW_CANCELLED_KEY) === "1");
    } catch {
      /* storage disabled: default hidden */
    }
  }, []);
  const toggleShowCancelled = useCallback(() => {
    setShowCancelled((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(SHOW_CANCELLED_KEY, next ? "1" : "0");
      } catch {
        /* private-mode / storage-disabled: in-memory only */
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

  // ?task=, ?epic=, ?sprint= and ?mine= are URL state so board slices and
  // task links can be shared.
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get("task");
  const epicFilter = searchParams.get("epic");
  const sprintParam = searchParams.get("sprint");
  const mineOnly = searchParams.get("mine") === "1";

  const today = useMemo(() => localTodayUtcDay(), []);
  const multiTerm = useMemo(
    () => new Set(options.sprints.map((s) => s.termId)).size > 1,
    [options.sprints],
  );
  const selectedSprint: SprintModel | null = useMemo(() => {
    const explicit = options.sprints.find((s) => s.id === sprintParam);
    if (explicit) return explicit;
    return (
      defaultBoardSprint(
        options.sprints.map((s) => ({ ...sprintDays(s), s })),
        today,
      )?.s ?? null
    );
  }, [options.sprints, sprintParam, today]);
  const selectedStatus = selectedSprint ? sprintStatus(sprintDays(selectedSprint), today) : null;
  const readOnly = selectedStatus === "Closed";
  const canEdit = canManage && !readOnly && selectedSprint !== null;
  const inSprint = useCallback(
    (t: TaskCardModel) => selectedSprint !== null && t.sprintId === selectedSprint.id,
    [selectedSprint],
  );

  // A closed sprint's board is its snapshot: carried tasks have since moved on.
  const [snapshot, setSnapshot] = useState<{ sprintId: string; cards: SnapshotCard[] } | null>(null);
  useEffect(() => {
    if (!selectedSprint?.closed || snapshot?.sprintId === selectedSprint.id) return;
    let live = true;
    void fetch(`/api/sprints/${selectedSprint.id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Request failed: ${r.status}`))))
      .then((j: { cards: SnapshotCard[] }) => {
        if (live) setSnapshot({ sprintId: selectedSprint.id, cards: j.cards });
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Load failed"));
    return () => {
      live = false;
    };
  }, [selectedSprint, snapshot?.sprintId, setError]);
  const carriedToById = useMemo(
    () =>
      new Map(
        (snapshot?.sprintId === selectedSprint?.id ? snapshot?.cards ?? [] : []).map((c) => [
          c.id,
          c.carriedTo,
        ]),
      ),
    [snapshot, selectedSprint],
  );

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
  const setEpicFilter = useCallback((value: string | null) => setParam("epic", value), [setParam]);
  const setOpenTaskId = useCallback(
    (id: string | null) => setParam("task", id),
    [setParam],
  );

  // A seeded epic the filter excludes would create the card and hide it in the
  // same breath, so the filter steps aside.
  useEffect(() => {
    if (!createSeed) return;
    setCreateStatus("Todo");
    setCreateLinks(createSeed);
    createLinksRef.current = createSeed;
    setIsCreating(true);
    if (createSeed.epicId && epicFilter && epicFilter !== createSeed.epicId) {
      setParam("epic", null);
    }
    // Only a fresh seed object should reopen the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSeed]);

  const filteredTasks = useMemo(() => {
    let ts: TaskCardModel[] = selectedSprint?.closed
      ? snapshot?.sprintId === selectedSprint.id
        ? snapshot.cards
        : []
      : tasks.filter(inSprint);
    if (epicFilter) ts = ts.filter((t) => t.epicId === epicFilter);
    if (mineOnly) ts = ts.filter((t) => t.assignees.some((a) => a.id === currentUserId));
    if (filterPeopleIds.length > 0) {
      const want = new Set(filterPeopleIds);
      ts = ts.filter((t) => t.assignees.some((a) => want.has(a.id)));
    }
    if (query.trim()) ts = ts.filter((t) => taskMatchesQuery(t, query));
    return ts;
  }, [
    tasks,
    selectedSprint,
    snapshot,
    inSprint,
    epicFilter,
    mineOnly,
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
    // Status isn't a PATCH field: it goes through the move endpoint, which
    // owns column ordering. The card lands at the end of its new column.
    const current = tasks.find((t) => t.id === taskId);
    const toStatus =
      patch.status && current && patch.status !== current.status ? patch.status : null;
    const { status: _status, ...fields } = patch;
    return new Promise((resolve) => {
      move(
        (cur) => {
          const moved = toStatus
            ? moveTaskInBoard(cur, taskId, toStatus, -1, inSprint).tasks
            : cur;
          return moved.map((t) => (t.id === taskId ? { ...t, ...fields } : t));
        },
        async () => {
          const body: Record<string, unknown> = {};
          if ("domain" in patch) body.domainId = patch.domain?.id ?? null;
          if ("assignees" in patch)
            body.assigneeIds = (patch.assignees ?? []).map((a) => a.id);
          if ("title" in patch) body.title = patch.title;
          if ("description" in patch) body.description = patch.description;
          if ("epicId" in patch && patch.epicId) body.epicId = patch.epicId;
          if ("sprintId" in patch) body.sprintId = patch.sprintId ?? null;
          if ("checklist" in patch) body.checklist = patch.checklist ?? null;
          if ("isCodeTask" in patch) body.isCodeTask = patch.isCodeTask;
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
              const { orderedIds } = moveTaskInBoard(tasks, taskId, toStatus, -1, inSprint);
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
    if (!canEdit) return;
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
      // Index among the sprint's whole column, so tasks hidden by the epic or
      // people filters keep their relative order.
      targetIndex = buildTaskBoard(tasks.filter(inSprint))[toStatus].findIndex(
        (t) => t.id === overId,
      );
    }

    const orderedIds = moveTaskInBoard(tasks, taskId, toStatus, targetIndex, inSprint).orderedIds;
    move(
      (cur) => moveTaskInBoard(cur, taskId, toStatus, targetIndex, inSprint).tasks,
      () => persistMove(taskId, toStatus, orderedIds).then(refresh),
    );
    if (toStatus === "Done" && fromStatus !== "Done") setCelebrate(true);
  }

  // Domain and assignees aren't create fields; they follow as a PATCH.
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
        epicId: values.epicId,
        sprintId: values.sprintId,
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
        position: nextPositionInColumn(
          buildTaskBoard(cur.filter((t) => t.sprintId === values.sprintId)),
          values.status,
        ),
        epicId: values.epicId,
        sprintId: values.sprintId,
        carryoverCount: 0,
        isCodeTask: false,
        pullRequests: [],
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
    // Closed before the follow-up patches: the card is already on the board
    // optimistically, so there's nothing to wait for before handing the epic
    // modal back. (Declared below as a const — only ever called from here, long
    // after render.)
    closeCreate();

    // Push the fields the create endpoint doesn't accept. patchTask owns its
    // own optimistic update + rollback, so the card already reflects them.
    const patch: Partial<TaskCardModel> = {};
    if (domain) patch.domain = domain;
    if (assignees.length > 0) patch.assignees = assignees;
    if (values.isCodeTask) patch.isCodeTask = true;
    if (Object.keys(patch).length > 0) {
      await patchTask(id, patch);
    } else {
      refresh();
    }
  }

  // The single exit from the create form, used by both Save and Cancel: a task
  // filed from a story row is rarely the only one, so whatever had to close to
  // make room for the form is handed back its turn here.
  //
  // It reads the seed off a ref, not state, because this runs twice on a save:
  // the board closes the form before awaiting the follow-up patches (so it
  // doesn't sit there spinning), and TaskModal then calls onClose of its own
  // accord once onCreate resolves — by which point it has already unmounted and
  // is holding an older closure. Clearing the ref is synchronous, so the second
  // call sees null and onCreateClosed fires exactly once per form.
  const closeCreate = useCallback(() => {
    const seed = createLinksRef.current;
    createLinksRef.current = null;
    setIsCreating(false);
    setCreateLinks(null);
    if (seed) onCreateClosed?.(seed);
  }, [onCreateClosed]);

  const startCreate = useCallback((status: TaskStatus) => {
    setCreateStatus(status);
    setCreateLinks(null);
    createLinksRef.current = null;
    setIsCreating(true);
  }, []);

  const columns: KanbanColumn<TaskCardModel>[] = BOARD_STATUSES.filter(
    (status) => showCancelled || status !== "Cancelled",
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
            {canEdit && (
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
      listHeader: canEdit ? (
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

  const activeFilterCount = (epicFilter ? 1 : 0) + (mineOnly ? 1 : 0);

  const epicOptions: ComboOption[] = useMemo(
    () => [
      { value: null, label: "All epics" },
      ...options.epics.map((e) => ({ value: e.id as string | null, label: e.title })),
    ],
    [options.epics],
  );
  const sprintOptions = useMemo(
    () =>
      [...options.sprints]
        .sort((a, z) => Date.parse(z.startsOn) - Date.parse(a.startsOn))
        .map((s) => {
          const status = sprintStatus(sprintDays(s), today);
          return {
            value: s.id,
            label: `${sprintLabel(s, multiTerm)} · ${status === "Active" ? "Current" : status === "Closed" ? "Past" : "Upcoming"}`,
            description: sprintRangeLabel(s),
          };
        }),
    [options.sprints, today, multiTerm],
  );

  const resetFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ["epic", "mine"]) next.delete(key);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [setSearchParams]);

  return (
    <div className={cn("flex flex-col", os ? "gap-4" : "gap-3")}>
      <Confetti trigger={celebrate} onFire={() => setCelebrate(false)} />
      <SprintHeader
        sprint={selectedSprint}
        status={selectedStatus}
        options={sprintOptions}
        multiTerm={multiTerm}
        onSelect={(id) => setParam("sprint", id)}
        anchorControl={
          <SprintAnchorControl
            projectId={projectId}
            anchors={options.anchors}
            canEdit={canManage}
            focusTermId={selectedSprint?.termId ?? null}
            onSaved={refresh}
          />
        }
      />
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

                <FilterToggleRow
                  label="Only my tasks"
                  os={os}
                  checked={mineOnly}
                  onChange={() => setParam("mine", mineOnly ? null : "1")}
                />

                {options.epics.length > 0 && (
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
              </section>

              <section
                className={cn(
                  "flex flex-col gap-3 border-t pt-3",
                  os ? "border-os-container" : "border-border",
                )}
              >
                <FilterSectionLabel os={os}>Layout</FilterSectionLabel>
                <FilterToggleRow
                  label="Show Cancelled column"
                  os={os}
                  checked={showCancelled}
                  onChange={toggleShowCancelled}
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
                <span className="flex items-center gap-1.5">
                  {archiving ? "Archiving…" : "Archive Done & Cancelled"}
                  <InfoTip content="Immediately hides all Done and Cancelled tasks from the board. Archived tasks are not deleted." />
                </span>
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

      {selectedSprint === null && (
        <p className="text-sm text-muted-foreground">
          This project has no sprints yet — sprints are generated for each current or upcoming
          term the project runs. Add a term in project settings; until then, plan in the Backlog.
        </p>
      )}

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
        draggable={canEdit}
        sortable
        dropPlaceholder
        onDragEnd={handleDragEnd}
        error={error}
        renderOverlay={(activeId) => {
          const t = activeId ? tasks.find((x) => x.id === activeId) : null;
          return t ? (
            <div className="w-60 rotate-1 shadow-xl">
              <TaskCard
                card={t}
                carriedTo={null}
                codeTasksEnabled={options.codeTasksEnabled}
                isDragging={false}
                onOpen={() => {}}
              />
            </div>
          ) : null;
        }}
        renderCard={(card, { isDragging, dragHandleProps }) => (
          <TaskCard
            card={card}
            carriedTo={carriedToById.get(card.id) ?? null}
            codeTasksEnabled={options.codeTasksEnabled}
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
          canManage={canManage && !(openTask.sprintId && options.sprints.find((s) => s.id === openTask.sprintId)?.closed && isTaskFinished(openTask))}
          onClose={() => setOpenTaskId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onDelete={() => deleteTask(openTask.id)}
          onArtifactsChanged={refresh}
          onCommentCountChange={(count) => {
            setItems((cur) =>
              cur.map((t) =>
                t.id === openTask.id ? { ...t, commentCount: count } : t,
              ),
            );
          }}
        />
      )}

      {isCreating && (
        <TaskModal
          projectId={projectId}
          options={options}
          canManage={canManage}
          defaultEpicId={createLinks?.epicId ?? epicFilter ?? null}
          defaultSprintId={canEdit ? selectedSprint?.id ?? null : null}
          defaultStatus={createStatus}
          onClose={closeCreate}
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
  disabled = false,
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
  /** Greyed + non-interactive (e.g. Sprint before a term is chosen). */
  disabled?: boolean;
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

  // A set filter wears the pills' selected dress, so a slice that's on reads
  // the same whether it was picked from a pill row or typed into a field.
  const active = value !== null;

  return (
    <div
      // Blur is scoped to the whole control, not the input: closing on the
      // input's own blur meant a press anywhere in the list — its padding, the
      // gap between rows, the scrollbar — tore the list down mid-click, which
      // is what read as the field flickering.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <FilterField label={label} os={os}>
        <div className="relative">
          <input
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={id}
            aria-autocomplete="list"
            aria-label={ariaLabel}
            aria-activedescendant={open && matches[activeIndex] ? `${id}-${activeIndex}` : undefined}
            disabled={disabled}
            value={disabled ? "" : open ? query : selectedLabel}
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
              "w-full rounded-full border py-1.5 pl-3 pr-8 text-xs transition-colors focus:outline-none",
              os
                ? "border-os-container bg-os-well text-foreground placeholder:text-os-muted focus:border-os-accent"
                : "border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-accent-coral",
              disabled && "cursor-not-allowed opacity-50",
              !open &&
                active &&
                (os
                  ? "border-os-accent bg-os-accent/15 text-os-accent"
                  : "border-accent-coral bg-accent-coral/10 text-accent-coral"),
            )}
          />
          {/* Without an end affordance the field reads as a text input someone
              pre-filled with "All epics" — nothing said it opens a list. A set
              filter swaps it for a clear, so getting back to "all" doesn't mean
              opening the list to hunt for that row. */}
          {active && !open ? (
            <button
              type="button"
              aria-label={`Clear ${label.toLowerCase()} filter`}
              onClick={() => commit(null)}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 transition-colors",
                os ? "text-os-accent hover:bg-os-accent/20" : "text-accent-coral hover:bg-accent-coral/20",
              )}
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              disabled={disabled}
              // Keep focus on the input, so the control's blur-close doesn't
              // fire between this press and the list rendering.
              onMouseDown={(e) => {
                e.preventDefault();
                if (!disabled) setOpen((v) => !v);
              }}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2",
                os ? "text-os-muted" : "text-muted-foreground",
              )}
            >
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>
          )}
        </div>
        {open && (
          <ul
            id={id}
            role="listbox"
            // Nothing inside the list should move focus off the input — a blur
            // and re-focus between mousedown and click is exactly the flicker.
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "max-h-40 w-full overflow-y-auto rounded-lg border p-1",
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
      </FilterField>
    </div>
  );
}


type ArchivedTask = {
  id: string;
  title: string;
  status: TaskStatus;
  sprint: string | null;
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
  carriedTo,
  codeTasksEnabled,
  dragHandleProps = {},
  isDragging,
  onOpen,
}: {
  card: TaskCardModel;
  // Set on a closed sprint's board for work that rolled on ("Sprint 5").
  carriedTo: string | null;
  codeTasksEnabled: boolean;
  dragHandleProps?: Record<string, unknown>;
  isDragging: boolean;
  onOpen: () => void;
}) {
  const { os } = useOsChrome();
  const slipping = card.carryoverCount > 0 && !isTaskFinished(card);
  const mergedCount = card.pullRequests.filter((p) => p.state === "merged").length;
  const codeTaskNeedsPr =
    codeTasksEnabled &&
    card.status !== "Done" &&
    requiresMergedPr({ isCodeTask: card.isCodeTask, domainCode: card.domain?.code }) &&
    mergedCount === 0;
  const checklist = Array.isArray(card.checklist) ? card.checklist : null;
  const checklistDone = checklist?.filter((i) => i.done).length ?? 0;

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
          {carriedTo && (
            <MetaItem
              icon={<ArrowRight aria-hidden className="w-3.5 h-3.5" />}
              title={`Unfinished at close — rolled to ${carriedTo}`}
            >
              {carriedTo}
            </MetaItem>
          )}
          {slipping && !carriedTo && (
            <MetaItem
              icon={
                <RotateCw
                  aria-hidden
                  className={cn("w-3.5 h-3.5", os ? "text-os-amber" : "text-accent-coral")}
                />
              }
              title={`Rolled over from ${card.carryoverCount} earlier sprint${card.carryoverCount === 1 ? "" : "s"}`}
            >
              Carried ×{card.carryoverCount}
            </MetaItem>
          )}
          {(card.pullRequests.length > 0 || codeTaskNeedsPr) && (
            <MetaItem
              icon={
                <GitPullRequest
                  aria-hidden
                  className={cn("w-3.5 h-3.5", codeTaskNeedsPr && (os ? "text-os-amber" : "text-accent-coral"))}
                />
              }
              title={
                codeTaskNeedsPr
                  ? "Code task — needs a merged pull request before Done"
                  : `${mergedCount} of ${card.pullRequests.length} pull request${card.pullRequests.length === 1 ? "" : "s"} merged`
              }
            >
              {codeTaskNeedsPr && card.pullRequests.length === 0
                ? "PR needed"
                : `${mergedCount}/${card.pullRequests.length}`}
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

function SprintHeader({
  sprint,
  status,
  options,
  multiTerm,
  onSelect,
  anchorControl,
}: {
  sprint: SprintModel | null;
  status: "Upcoming" | "Active" | "Closed" | null;
  options: { value: string; label: string; description: string }[];
  multiTerm: boolean;
  onSelect: (id: string) => void;
  anchorControl: ReactNode;
}) {
  const { os } = useOsChrome();
  if (!sprint) return <div className="flex justify-end">{anchorControl}</div>;
  const badge =
    status === "Active"
      ? os
        ? "bg-os-accent/15 text-os-accent"
        : "bg-accent-teal/15 text-[#00706f]"
      : "bg-muted text-muted-foreground";
  return (
    <div className={cn("flex flex-wrap items-center", os ? "gap-3" : "gap-2")}>
      <Select
        value={sprint.id}
        options={options}
        onChange={onSelect}
        ariaLabel="Choose sprint"
      />
      <span className={cn("text-muted-foreground", os ? "text-sm" : "text-xs")}>
        {sprintRangeLabel(sprint)}
      </span>
      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", badge)}>
        {status === "Active" ? "Current sprint" : status === "Closed" ? "Closed · read-only" : "Upcoming"}
      </span>
      {sprint.closed && sprint.plannedCount !== null && (
        <span className={cn("text-muted-foreground", os ? "text-sm" : "text-xs")}>
          {sprint.completedCount} of {sprint.plannedCount} done
          {sprint.carriedOverCount ? ` · ${sprint.carriedOverCount} rolled on` : ""}
        </span>
      )}
      <span className="sr-only">{sprintLabel(sprint, multiTerm)}</span>
      <div className="ml-auto">{anchorControl}</div>
    </div>
  );
}
