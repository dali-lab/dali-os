import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Menu, MenuItem, Popover, InfoTip } from "~/components/ui/floating";
import { Archive, ChevronDown, MoreHorizontal, SlidersHorizontal, X } from "lucide-react";
import { Confetti } from "~/components/Confetti";
import { KanbanBoard } from "~/components/board/KanbanBoard";
import { useOsChrome } from "~/components/os-chrome";
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
import { ALL_TERMS, termFilterOrder } from "~/lib/terms.shared";
import {
  buildTaskBoard,
  type TaskBoardOptions,
  taskMatchesQuery,
  type TaskCardModel,
  type TaskStatus,
  currentSprintBand,
  resolveSprintScope,
  taskInSprintScope,
  sprintPickerOptions,
  taskTermIds,
  openDependencies,
  isTaskFinished,
  isCarriedOverTask,
  type SprintScope,
  type TermWindow,
} from "../lib/task-board";
import { SearchInput } from "~/components/ui/SearchInput";
import { PeopleFilter, type PersonOption } from "./PeopleFilter";
import { TaskModal } from "./TaskModal";
import {
  ArchivedTasksModal,
  TaskCard,
  buildStatusColumns,
  useColumnLayout,
  useTaskBoardActions,
} from "./task-board-shared";

/** Epic/story context an outside Add task carries into the create form. Either
 *  side may be null — Add ▸ Task from the timeline toolbar has neither. */
export type TaskCreateSeed = {
  epicId: string | null;
  storyId: string | null;
  // The epic modal that closed to make room for this form, handed back when the
  // form closes so the next task is one click away instead of a trip back
  // through the timeline. Null where the add covered nothing up (the outline,
  // the Add menu, a column) — there, nothing should spring open.
  reopenEpicId?: string | null;
};

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
  // own filters (epic/sprint/term/mine/search) still apply on top.
  filterPeopleIds?: string[];
  // People who hold tasks on this project — the filter's options. Empty (or no
  // onPeopleChange) hides the control.
  peopleOptions?: PersonOption[];
  onPeopleChange?: (ids: string[]) => void;
};

// The `?epic=` filter value for tasks with no epic.
const NO_EPIC = "none";


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
  // The open task is tracked in the URL (`?task=<id>`) so GitHub issue mirrors
  // and other external links can deep-link straight to a task. The sprint
  // filter lives in `?sprint=` for the same reason (shareable board slices).
  const [searchParams, setSearchParams] = useSearchParams();
  const openTaskId = searchParams.get("task");
  const {
    tasks,
    error,
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
  } = useTaskBoardActions({
    projectId,
    initialTasks,
    options,
    canManage,
    currentUserId,
    currentUserName,
    openTaskId,
  });
  const {
    hideEmptyCols,
    toggleHideEmpty,
    collapsedCols,
    toggleCollapsed,
    persistCollapsed,
  } = useColumnLayout();
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
  // Board search. Deliberately component state, not a `?q=` param like the
  // epic/sprint/term filters: those are shareable slices set by a click, while
  // this changes on every keystroke — and a search-param change revalidates the
  // project loader, so `?q=` would refetch the whole board per character.
  const { os } = useOsChrome();
  const [query, setQuery] = useState("");

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

  // Term windows keyed by id — used to resolve a task's term from its own dates
  // (a task's sprint, and therefore its term, is derived, not stored).
  const termWindows = useMemo<TermWindow[]>(
    () =>
      options.termSpans.map((s) => ({
        id: options.terms.find((t) => t.code === s.code)?.id ?? s.code,
        startDate: new Date(s.startsAt),
        endDate: new Date(s.endsAt),
      })),
    [options.termSpans, options.terms],
  );

  // Stable "now" for the computed sprint grid; sprints are the term-anchored
  // 7-day bands the timeline draws (see task-board.ts).
  const now = useMemo(() => new Date(), []);

  // Linear-style carryover boundary: unfinished work dated before the current
  // sprint band's start rolls forward into it. On a break week (no band
  // running) fall back to the current term's start so past-term work still
  // carries. Null when there's no current term at all — then nothing carries.
  const carryoverBoundaryMs = useMemo<number | null>(() => {
    const band = currentSprintBand(options.termSpans, now);
    if (band) return band.key;
    const cur = termWindows.find((w) => w.id === options.currentTermId);
    return cur ? cur.startDate.getTime() : null;
  }, [options.termSpans, now, termWindows, options.currentTermId]);

  // Sprint is a drill-down under Term (sprint numbers reset each term): it only
  // applies once a specific term is chosen, and lists that term's sprints. The
  // board opens on the whole term; the current sprint is one pick away.
  const sprintEnabled = effectiveTerm !== ALL_TERMS;
  const selectedTermCode = useMemo(
    () => (sprintEnabled ? options.terms.find((t) => t.id === effectiveTerm)?.code ?? null : null),
    [sprintEnabled, options.terms, effectiveTerm],
  );
  const termHasToday =
    sprintEnabled &&
    effectiveTerm === options.currentTermId &&
    currentSprintBand(options.termSpans, now) !== null;
  const sprintScope: SprintScope = useMemo(() => {
    if (!sprintEnabled) return "all";
    const resolved = resolveSprintScope(sprintFilter, options.termSpans, now);
    // `current` is today's sprint, which lives in the current term only.
    return resolved === "current" && !termHasToday ? "all" : resolved;
  }, [sprintEnabled, sprintFilter, options.termSpans, now, termHasToday]);
  const sprintDeviates = sprintEnabled && sprintScope !== "all";

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
  // Sprint is a top-level scope independent of epic, so picking an epic leaves
  // it untouched.
  const setEpicFilter = useCallback(
    (value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set("epic", value);
          else next.delete("epic");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setSearchParams],
  );
  // Changing term drops the sprint filter (sprint numbers reset per term, and a
  // sprint from another term would leave the board empty) — the epic filter
  // stays put; its pill is kept visible below even when pruned so it can still
  // be cleared.
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

  // An outside Add task opens the create form here. Placed below the filter
  // state because it has to read the epic filter: a seeded epic the filter
  // excludes would create the card and hide it in the same breath, so the
  // filter steps aside. (Term and sprint are date-derived — nothing to clear
  // until the deadline is picked.)
  useEffect(() => {
    if (!createSeed) return;
    setCreateStatus("Todo");
    setCreateLinks(createSeed);
    createLinksRef.current = createSeed;
    setIsCreating(true);
    if (createSeed.epicId && epicFilter && epicFilter !== createSeed.epicId) {
      setParam("epic", null);
    }
    // epicFilter/setParam are read, not tracked: a filter change mid-form must
    // not reopen the modal. Only a fresh seed object should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSeed]);

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
    if (sprintScope !== "all") {
      ts = ts.filter(
        (t) =>
          taskInSprintScope(t, sprintScope, options.termSpans, now) ||
          // Linear-style: unfinished work from an earlier sprint rolls into the
          // current one (the board's default scope) so it can't fall off before
          // the term filter even sees it.
          (sprintScope === "current" && isCarriedOverTask(t, carryoverBoundaryMs)),
      );
    }
    if (effectiveTerm !== ALL_TERMS) {
      ts = ts.filter((t) => {
        // A task's terms come from its own dates: every term its span touches.
        // Undated (backlog) work is term-less — always visible so it stays the
        // pool you plan from.
        if (t.dueAt === null && t.startsAt === null) return true;
        // Unfinished work dated before the current sprint rolls forward onto the
        // current term's board — a past term is just an earlier cycle, so it
        // carries the same way rather than vanishing at rollover.
        if (effectiveTerm === options.currentTermId && isCarriedOverTask(t, carryoverBoundaryMs))
          return true;
        return taskTermIds(termWindows, t).includes(effectiveTerm);
      });
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
    sprintScope,
    options.termSpans,
    now,
    effectiveTerm,
    termWindows,
    options.currentTermId,
    carryoverBoundaryMs,
    filterPeopleIds,
    query,
  ]);

  const board = useMemo(() => buildTaskBoard(filteredTasks), [filteredTasks]);
  // Over the whole board, not the filtered slice: a task is blocked by what it
  // waits on even when that work is filtered out of view.
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const blockersOf = useCallback(
    (t: TaskCardModel) => openDependencies(t.dependsOn, tasksById, isTaskFinished),
    [tasksById],
  );
  const openTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;



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

  const columns = buildStatusColumns({
    board,
    os,
    canManage,
    hideEmptyCols,
    collapsedCols,
    onToggleCollapsed: toggleCollapsed,
    onAddTask: startCreate,
  });

  // The epic control only earns its place when the project has epics to slice
  // by. Under a term filter the option set is pruned to epics with work in it.
  const showEpicFilter = visibleEpics.length > 0;

  // What the Customize badge counts: every active slice bar the search box,
  // which has its own visible field. The term and sprint filters count only
  // when they aren't sitting on their default (this term / all its sprints).
  const defaultTerm = options.currentTermId ?? ALL_TERMS;
  const activeFilterCount =
    (epicFilter ? 1 : 0) +
    (sprintDeviates ? 1 : 0) +
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
  // The sprint combobox lists the selected term's computed sprints
  // (`Sprint N · Current|Past|Upcoming`, current-first). Its default, the whole
  // term, is the neutral (`null`) row, so sitting on it reads as "no filter"
  // and doesn't light the Customize badge — the same convention the term filter
  // uses for the current term.
  const sprintScopeOptions: ComboOption[] = useMemo(() => {
    const opts: ComboOption[] = [{ value: null, label: "All sprints" }];
    if (termHasToday) opts.push({ value: "current", label: "Current sprint" });
    opts.push({ value: "backlog", label: "Backlog (no sprint)" });
    for (const o of sprintPickerOptions(options.termSpans, selectedTermCode, now)) {
      opts.push({ value: o.value, label: o.label });
    }
    return opts;
  }, [termHasToday, options.termSpans, selectedTermCode, now]);

  const resetFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of ["epic", "sprint", "term"]) next.delete(key);
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

                {/* Sprint: a drill-down under Term. Sprint numbers reset per
                    term, so it's disabled on "All terms" and lists the selected
                    term's sprints once one is chosen. The default scope is the
                    neutral row. */}
                {termFilterEnabled && (
                  <FilterCombobox
                    id="taskboard-sprint-scope"
                    label="Sprint"
                    ariaLabel="Filter board by sprint"
                    placeholder={sprintEnabled ? "Search sprints…" : "Select a term first"}
                    os={os}
                    options={sprintScopeOptions}
                    value={sprintScope === "all" ? null : sprintScope}
                    onChange={(next) => setParam("sprint", next)}
                    disabled={!sprintEnabled}
                  />
                )}

                {termFilterEnabled && (
                  <FilterGroup
                    label="Term"
                    os={os}
                    hint={
                      <InfoTip
                        content="Term code format: last two digits of the year + S (spring), F (fall), or X (summer). E.g. 26F = Fall 2026."
                        placement="right"
                      />
                    }
                  >
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
                  </FilterGroup>
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
              </section>

              <section
                className={cn(
                  "flex flex-col gap-3 border-t pt-3",
                  os ? "border-os-container" : "border-border",
                )}
              >
                <FilterSectionLabel os={os}>Layout</FilterSectionLabel>
                <FilterToggleRow
                  label="Hide empty Backlog / Cancelled"
                  os={os}
                  checked={hideEmptyCols}
                  onChange={toggleHideEmpty}
                />
                {collapsedCols.length > 0 && (
                  <button
                    type="button"
                    onClick={() => persistCollapsed([])}
                    className={cn(
                      "self-start text-xs underline-offset-2 hover:underline",
                      os ? "text-os-accent" : "text-os-accent",
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
          onOpenTask={setOpenTaskId}
          canManage={canManage}
          onClose={() => setOpenTaskId(null)}
          onPatch={(patch) => patchTask(openTask.id, patch)}
          onDelete={() => {
            setOpenTaskId(null);
            return deleteTask(openTask.id);
          }}
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
          allTasks={tasks}
          canManage={canManage}
          // An outside add's own epic/story wins; otherwise the board's epic
          // filter stands in, as it always has.
          defaultEpicId={
            createLinks?.epicId ??
            (epicFilter && epicFilter !== NO_EPIC ? epicFilter : null)
          }
          defaultStoryId={createLinks?.storyId ?? null}
          defaultStatus={createStatus}
          onClose={closeCreate}
          onCreate={(values) => createTask(values, closeCreate)}
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
                : "border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-os-accent",
              disabled && "cursor-not-allowed opacity-50",
              !open &&
                active &&
                (os
                  ? "border-os-accent bg-os-accent/15 text-os-accent"
                  : "border-os-accent bg-os-accent/10 text-os-accent"),
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
                os ? "text-os-accent hover:bg-os-accent/20" : "text-os-accent hover:bg-os-accent/20",
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
                        : "text-os-accent"
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
