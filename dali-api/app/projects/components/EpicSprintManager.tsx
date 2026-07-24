import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRevalidator } from "react-router";
import { X, GripVertical, Check, Trash2, Pencil, Maximize2 } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { EpicsTimeline, type TimelineEpic } from "./EpicsTimeline";

export type EditableStory = {
  id: string;
  title: string;
  notes: string | null;
  status: "Todo" | "InProgress" | "Done";
};

export type EditableEpic = {
  id: string;
  title: string;
  // Plain-text epic description. Null when unset.
  description: string | null;
  status: "Backlog" | "Open" | "InProgress" | "Done" | "Cancelled";
  // ISO strings or null when unset. Explicit epic span; the timeline prefers
  // these over sprint-derived dates.
  startsAt: string | null;
  endsAt: string | null;
  // Optional target term for cross-term epics — a planning signal ("we intend
  // to land this in 26F"), not a hard scope. Null when unset. The board's term
  // filter treats it as one of the terms an epic counts toward.
  targetTermId: string | null;
  // Collab-doc reference for the epic's rich description (Notion-style),
  // same pattern as the project Overview/PRD pages. Null when none attached.
  descriptionDocId: string | null;
  // User stories under this epic, ordered by position.
  stories: EditableStory[];
};

// A term the project runs, for the epic target-term picker. Newest first.
export type EpicTermOption = { id: string; code: string };

export type EditableSprint = {
  id: string;
  name: string;
  // ISO strings; rendered into <input type="date"> as YYYY-MM-DD.
  startsAt: string;
  endsAt: string;
  status: "Planned" | "Active" | "Closed";
  epicId: string | null;
};

const EPIC_STATUSES = ["Backlog", "Open", "InProgress", "Done", "Cancelled"] as const;
const SPRINT_STATUSES = ["Planned", "Active", "Closed"] as const;

type Props = {
  projectId: string;
  epics: EditableEpic[];
  sprints: EditableSprint[];
  // The project's planned terms (newest first) — options for an epic's
  // optional target term. Empty hides the picker.
  terms: EpicTermOption[];
  // Per-epic task progress keyed by epic id (Cancelled tasks excluded from
  // both numbers). Epics with no counted tasks may simply be absent.
  taskCounts: Record<string, { done: number; total: number }>;
  canManage: boolean;
  // Hocuspocus WebSocket auth token; userName labels the presence cursor.
  // Both are forwarded into the EpicDetail modal where the description
  // CollaborativeEditor lives. Null token = signed-out / no-cookie state;
  // the editor's read-only fallback handles it.
  collabToken: string | null;
  userName: string;
  // Which body to render. "timeline" (the default planning view) swaps the
  // epic/sprint list for the clickable timeline; the New-epic + detail modals
  // stay shared across both. "list" keeps the original manager.
  view?: "list" | "timeline";
  // TimelineEpic shape for the timeline body (only read when view=timeline).
  timelineEpics?: TimelineEpic[];
  // The list/timeline view switch, rendered on the toolbar row (right side),
  // with the "Add epic" button on the left of the same line.
  viewToggle?: ReactNode;
};

function dateInputValue(iso: string): string {
  // <input type="date"> wants YYYY-MM-DD.
  return new Date(iso).toISOString().slice(0, 10);
}

// Same request/error handling as `api`, but hands back the parsed response.
// Used by epic creation, which needs the new id to open its detail modal.
async function apiJson<T>(url: string, method: "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed: ${res.status}`);
  }
  return json as T;
}

async function api(url: string, method: "POST" | "DELETE", body?: unknown): Promise<void> {
  await apiJson<unknown>(url, method, body);
}

export function EpicSprintManager({
  projectId,
  epics,
  sprints,
  terms,
  taskCounts,
  canManage,
  collabToken,
  userName,
  view = "list",
  timelineEpics = [],
  viewToggle,
}: Props) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newEpicOpen, setNewEpicOpen] = useState(false);
  // "All" shows every epic; otherwise only epics matching the selected
  // status. Reordering is disabled while filtered — the reorder endpoint
  // requires the full epic id set, and a filtered drag would only submit a
  // subset (see /api/projects/:id/epics/reorder).
  const [statusFilter, setStatusFilter] = useState<"All" | EditableEpic["status"]>("All");
  const [epicsOpen, setEpicsOpen] = useState(true);
  // The all-sprints section below the epic list.
  const [allSprintsOpen, setAllSprintsOpen] = useState(true);
  const [newSprintOpen, setNewSprintOpen] = useState(false);
  const [editSprintId, setEditSprintId] = useState<string | null>(null);
  // The selected epic opens its detail view in a modal over the list.
  const [openEpicId, setOpenEpicId] = useState<string | null>(null);
  // When set, the detail panel opens straight into the epic edit form rather
  // than the default read view (used by deep flows that mean "edit now").
  const [openInEdit, setOpenInEdit] = useState(false);
  // When set, the detail panel opens with this sprint's edit form expanded
  // (entered by clicking a nested sprint row in the epic list).
  const [openSprintId, setOpenSprintId] = useState<string | null>(null);
  // Opens the epic detail already scrolled to the Sprints section (e.g. "Add one").
  const [openAddSprint, setOpenAddSprint] = useState(false);
  // Which epics are expanded to show their nested sprints in the list.
  const [expandedEpicIds, setExpandedEpicIds] = useState<Set<string>>(new Set());

  function toggleExpanded(epicId: string) {
    setExpandedEpicIds((cur) => {
      const next = new Set(cur);
      if (next.has(epicId)) next.delete(epicId);
      else next.add(epicId);
      return next;
    });
  }

  function openEpic(
    epicId: string,
    opts?: { edit?: boolean; sprintId?: string; addSprint?: boolean },
  ) {
    setOpenInEdit(opts?.edit ?? false);
    setOpenSprintId(opts?.sprintId ?? null);
    setOpenAddSprint(opts?.addSprint ?? false);
    setOpenEpicId(epicId);
  }

  function closeEpic() {
    setOpenEpicId(null);
    setOpenInEdit(false);
    setOpenSprintId(null);
    setOpenAddSprint(false);
  }

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    fn()
      .then(() => revalidator.revalidate())
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"))
      .finally(() => setBusy(false));
  }

  // Optimistic epic order: drag updates it immediately so the row animates to
  // its new slot without waiting on the round trip; a revalidate reconciles
  // with the server, and a failed save reverts it. Synced from `epics` (keyed
  // off the prop's identity, same as StaffingBoard's `order` state) so a
  // server-side change (another editor, or our own save landing) adopts.
  const [orderedEpics, setOrderedEpics] = useState(epics);
  useEffect(() => setOrderedEpics(epics), [epics]);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleEpicDragEnd(event: DragEndEvent) {
    if (!canManage) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedEpics.findIndex((e) => e.id === active.id);
    const newIndex = orderedEpics.findIndex((e) => e.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const prev = orderedEpics;
    const next = arrayMove(orderedEpics, oldIndex, newIndex);
    setOrderedEpics(next);
    setError(null);

    api(`/api/projects/${projectId}/epics/reorder`, "POST", { epicIds: next.map((e) => e.id) })
      .then(() => revalidator.revalidate())
      .catch((e) => {
        setOrderedEpics(prev);
        setError(e instanceof Error ? e.message : "Failed to reorder epics");
      });
  }

  const errorBanner = error && (
    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
      {error}
    </div>
  );

  // The selected epic's detail view is rendered inside a modal over the list.
  // It survives revalidation because we look the epic up fresh each render.
  const activeEpic = openEpicId ? epics.find((e) => e.id === openEpicId) : null;

  const visibleEpics =
    statusFilter === "All"
      ? orderedEpics
      : orderedEpics.filter((e) => e.status === statusFilter);
  const filtering = statusFilter !== "All";

  // For the all-sprints section: resolve each sprint's owning epic title.
  const epicTitleById = new Map(epics.map((e) => [e.id, e.title]));

  return (
    <div className="flex flex-col gap-4">
      {errorBanner}

      {/* Toolbar: "Add epic" (timeline view) on the left, the list/timeline
          toggle on the right — same line. */}
      {viewToggle && (
        <div className="flex items-center justify-between gap-2">
          {view === "timeline" && canManage ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setNewEpicOpen(true)}
            >
              + Add epic
            </Button>
          ) : (
            <span />
          )}
          {viewToggle}
        </div>
      )}

      {/* New epic — a modal like the detail view, not inline inputs in the
          list. On save we immediately reopen as the real detail modal for the
          created epic (see onSubmit), so sprints/stories can be added right
          away without hunting for the new row. */}
      <Modal
        open={newEpicOpen}
        onClose={() => setNewEpicOpen(false)}
        labelledBy="new-epic-title"
        disableEscape={busy}
        containerClassName="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-5 sm:p-6 my-auto"
      >
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 id="new-epic-title" className="font-heading text-lg font-semibold text-foreground">
            New epic
          </h2>
          <button
            type="button"
            onClick={() => setNewEpicOpen(false)}
            aria-label="Close"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Name it and save — you can add sprints, stories and a description next.
        </p>
        <EpicForm
          busy={busy}
          terms={terms}
          onCancel={() => setNewEpicOpen(false)}
          onSubmit={(values) =>
            run(async () => {
              const created = await apiJson<{ id: string }>(
                `/api/projects/${projectId}/epics`,
                "POST",
                values,
              );
              setNewEpicOpen(false);
              // Hand straight off to the detail modal, scrolled to Sprints —
              // this is what makes "add sprints while creating the first epic"
              // a single flow. `openEpic` only sets the id; the modal renders
              // once the revalidate in `run` lands the new row in `epics`.
              openEpic(created.id, { edit: false, addSprint: true });
            })
          }
        />
      </Modal>

      <Modal
        open={activeEpic != null}
        onClose={closeEpic}
        labelledBy="epic-detail-title"
        disableEscape={busy}
        containerClassName="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-5 sm:p-6 my-auto"
      >
        {activeEpic && (
          <EpicDetail
            projectId={projectId}
            epic={activeEpic}
            sprints={sprints.filter((s) => s.epicId === activeEpic.id)}
            terms={terms}
            canManage={canManage}
            busy={busy}
            startInEdit={openInEdit}
            startEditSprintId={openSprintId}
            startAddSprint={openAddSprint}
            run={run}
            api={api}
            collabToken={collabToken}
            userName={userName}
            onClose={closeEpic}
            onDeleted={closeEpic}
          />
        )}
      </Modal>

      {view === "timeline" ? (
        <div className="flex flex-col gap-3">
          {/* Clicking an epic or sprint bar opens the same detail/edit modal
              the list view uses (openEpic). */}
          <EpicsTimeline
            epics={timelineEpics}
            taskCounts={taskCounts}
            onEpicClick={canManage ? (id) => openEpic(id) : undefined}
            onSprintClick={
              canManage
                ? (epicId, sprintId) => openEpic(epicId, { sprintId })
                : undefined
            }
          />
        </div>
      ) : (
        <>
      {/* Epics */}
      <section className="bg-card border border-border rounded-lg p-4">
        <div className={`flex items-center justify-between gap-2 ${epicsOpen ? "mb-3" : ""}`}>
          <button
            type="button"
            onClick={() => setEpicsOpen((o) => !o)}
            aria-expanded={epicsOpen}
            className="flex items-center gap-1.5 min-w-0"
          >
            <span
              aria-hidden
              className={`inline-block text-muted-foreground transition-transform ${epicsOpen ? "rotate-90" : ""}`}
            >
              ›
            </span>
            <h3 className="text-sm font-semibold text-foreground">Epics</h3>
          </button>
          <div className="flex items-center gap-3">
            {epics.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="sr-only">Filter by status</span>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as "All" | EditableEpic["status"])
                  }
                  aria-label="Filter epics by status"
                  className="px-1.5 py-1 text-xs border border-border rounded-md bg-background text-foreground"
                >
                  <option value="All">All statuses</option>
                  {EPIC_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {canManage && !newEpicOpen && (
              <button
                type="button"
                onClick={() => {
                  setEpicsOpen(true);
                  setNewEpicOpen(true);
                }}
                className="text-xs font-medium text-accent-coral hover:underline flex-shrink-0"
              >
                + New epic
              </button>
            )}
          </div>
        </div>

        {epicsOpen && (
          <>
        {/* Reordering needs the full epic id set, so drag grips disappear
            while a status filter is active — say so instead of hiding them
            silently. */}
        {filtering && canManage && orderedEpics.length > 1 && visibleEpics.length > 0 && (
          <p className="text-[11px] text-muted-foreground italic mb-2">
            Clear the status filter to reorder.
          </p>
        )}
        {visibleEpics.length === 0 && !newEpicOpen ? (
          <p className="text-sm text-muted-foreground italic">
            {filtering ? `No epics with status "${statusFilter}".` : "No epics yet."}
          </p>
        ) : (
          <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleEpicDragEnd}>
            <SortableContext items={visibleEpics.map((e) => e.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col divide-y divide-border">
                {visibleEpics.map((epic) => {
              const epicSprints = sprints.filter((s) => s.epicId === epic.id);
              const expanded = expandedEpicIds.has(epic.id);
              const counts = taskCounts[epic.id];
              return (
                <SortableEpicRow key={epic.id} id={epic.id} draggable={canManage && !filtering}>
                  {(dragHandleProps, isDragging) => (
                <div className={`py-1 ${isDragging ? "opacity-60" : ""}`}>
                  <div className="py-1 flex items-center gap-2 text-sm hover:bg-muted/50 -mx-2 px-2 rounded transition-colors">
                    {canManage && !filtering && (
                      <div
                        {...dragHandleProps}
                        aria-label={`Reorder ${epic.title}`}
                        className="flex-shrink-0 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                    )}
                    {/* Chevron toggles the nested sprint list. Present on every
                        row (even sprint-less epics, where it reveals an "add"
                        affordance) so the rows stay aligned. */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(epic.id)}
                      aria-label={expanded ? `Collapse ${epic.title}` : `Expand ${epic.title}`}
                      aria-expanded={expanded}
                      className="flex-shrink-0 w-4 text-muted-foreground hover:text-foreground transition-transform"
                    >
                      <span
                        aria-hidden
                        className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
                      >
                        ›
                      </span>
                    </button>
                    <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <button
                        type="button"
                        onClick={() => openEpic(epic.id)}
                        className="min-w-0 text-left"
                      >
                        <span className="text-foreground">{epic.title}</span>
                        {epic.startsAt && epic.endsAt && (
                          <span className="text-[11px] text-muted-foreground ml-2">
                            {dateInputValue(epic.startsAt)} → {dateInputValue(epic.endsAt)}
                          </span>
                        )}
                      </button>
                      {/* Status sits between the name and the sprint/story
                          counts. Managers can change it inline without opening
                          the epic; viewers see a static pill. */}
                      {canManage ? (
                        <select
                          value={epic.status}
                          disabled={busy}
                          aria-label={`Status for ${epic.title}`}
                          onChange={(e) => {
                            const status = e.target.value;
                            run(() => api(`/api/epics/${epic.id}`, "POST", { status }));
                          }}
                          className="text-[11px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted/30 disabled:opacity-60"
                        >
                          {EPIC_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted/30">
                          {epic.status}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openEpic(epic.id)}
                        className="text-[11px] text-muted-foreground text-left"
                      >
                        {epicSprints.length}{" "}
                        {epicSprints.length === 1 ? "sprint" : "sprints"} ·{" "}
                        {epic.stories.length}{" "}
                        {epic.stories.length === 1 ? "story" : "stories"}
                      </button>
                      {counts && counts.total > 0 && (
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {counts.done}/{counts.total} tasks
                          <span
                            aria-hidden
                            className="inline-block w-14 h-0.5 rounded-full bg-border overflow-hidden"
                          >
                            <span
                              className="block h-full rounded-full bg-accent-teal/70"
                              style={{
                                width: `${Math.round((counts.done / counts.total) * 100)}%`,
                              }}
                            />
                          </span>
                        </span>
                      )}
                    </div>
                    <Tooltip label="Open">
                      <button
                        type="button"
                        onClick={() => openEpic(epic.id)}
                        aria-label={`Open ${epic.title}`}
                        className="flex-shrink-0 text-muted-foreground hover:text-accent-coral"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </div>

                  {expanded && (
                    <div className="ml-6 mt-0.5 flex flex-col border-l border-border pl-3">
                      {epicSprints.length === 0 ? (
                        <p className="py-1.5 text-[11px] text-muted-foreground italic">
                          No sprints yet.{" "}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() =>
                                openEpic(epic.id, { edit: false, addSprint: true })
                              }
                              className="text-accent-coral hover:underline"
                            >
                              Add one
                            </button>
                          )}
                        </p>
                      ) : (
                        epicSprints.map((sprint) => (
                          <button
                            key={sprint.id}
                            type="button"
                            onClick={() => openEpic(epic.id, { sprintId: sprint.id })}
                            className="py-1.5 flex items-center justify-between gap-3 text-left text-[13px] hover:bg-muted/50 -ml-3 pl-3 pr-2 rounded transition-colors"
                          >
                            <span className="min-w-0 truncate">
                              <span className="text-foreground">{sprint.name}</span>
                              <span className="text-[11px] text-muted-foreground ml-2">
                                {dateInputValue(sprint.startsAt)} →{" "}
                                {dateInputValue(sprint.endsAt)}
                              </span>
                            </span>
                            <span className="text-[11px] text-muted-foreground flex-shrink-0">
                              {sprint.status}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                  )}
                </SortableEpicRow>
              );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
          </>
        )}
      </section>

      {/* All sprints — sprints can exist without an epic (Sprint.epicId is
          nullable and the task board filters by sprint), so the epic detail
          modal isn't a complete home for them. Every sprint is listed and
          editable here; per-epic editing inside the modal stays intact. */}
      <section className="bg-card border border-border rounded-lg p-4">
        <div className={`flex items-center justify-between gap-2 ${allSprintsOpen ? "mb-3" : ""}`}>
          <button
            type="button"
            onClick={() => setAllSprintsOpen((o) => !o)}
            aria-expanded={allSprintsOpen}
            className="flex items-center gap-1.5 min-w-0"
          >
            <span
              aria-hidden
              className={`inline-block text-muted-foreground transition-transform ${allSprintsOpen ? "rotate-90" : ""}`}
            >
              ›
            </span>
            <h3 className="text-sm font-semibold text-foreground">Sprints</h3>
          </button>
          {canManage && !newSprintOpen && (
            <button
              type="button"
              onClick={() => {
                setAllSprintsOpen(true);
                setNewSprintOpen(true);
              }}
              className="text-xs font-medium text-accent-coral hover:underline"
            >
              + New sprint
            </button>
          )}
        </div>

        {allSprintsOpen && (
          <>
        {newSprintOpen && (
          <SprintForm
            busy={busy}
            epics={epics}
            onCancel={() => setNewSprintOpen(false)}
            onSubmit={(values) =>
              run(async () => {
                await api(`/api/projects/${projectId}/sprints`, "POST", values);
                setNewSprintOpen(false);
              })
            }
          />
        )}

        {sprints.length === 0 && !newSprintOpen ? (
          <p className="text-sm text-muted-foreground italic">No sprints yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {sprints.map((sprint) =>
              editSprintId === sprint.id ? (
                <div key={sprint.id} className="py-2">
                  <SprintForm
                    busy={busy}
                    initial={sprint}
                    epics={epics}
                    onCancel={() => setEditSprintId(null)}
                    onSubmit={(values) =>
                      run(async () => {
                        await api(`/api/sprints/${sprint.id}`, "POST", values);
                        setEditSprintId(null);
                      })
                    }
                    onDelete={() => {
                      if (
                        !window.confirm(
                          `Delete sprint "${sprint.name}"? Its tasks move back to the backlog.`,
                        )
                      )
                        return;
                      run(async () => {
                        await api(`/api/sprints/${sprint.id}`, "DELETE");
                        setEditSprintId(null);
                      });
                    }}
                  />
                </div>
              ) : (
                <div
                  key={sprint.id}
                  className="py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-foreground">{sprint.name}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-muted/30">
                      {sprint.status}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {dateInputValue(sprint.startsAt)} → {dateInputValue(sprint.endsAt)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {sprint.epicId ? (
                        (epicTitleById.get(sprint.epicId) ?? "Unknown epic")
                      ) : (
                        <span className="italic">No epic</span>
                      )}
                    </span>
                  </div>
                  {canManage && (
                    <Tooltip label="Edit sprint">
                      <button
                        type="button"
                        onClick={() => setEditSprintId(sprint.id)}
                        aria-label="Edit sprint"
                        className="text-muted-foreground hover:text-foreground flex-shrink-0"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  )}
                </div>
              ),
            )}
          </div>
        )}
          </>
        )}
      </section>
        </>
      )}
    </div>
  );
}

// Sortable wrapper for one epic row. Split from the row body (a render-prop
// child) so the drag handle can be spread onto a small grip icon rather than
// the whole row — the row has its own buttons/select the drag listeners must
// not swallow (see TaskBoard's identical handle/body split).
function SortableEpicRow({
  id,
  draggable,
  children,
}: {
  id: string;
  draggable: boolean;
  children: (dragHandleProps: Record<string, unknown>, isDragging: boolean) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const dragHandleProps = draggable
    ? ({ ...attributes, ...listeners } as Record<string, unknown>)
    : {};

  return (
    <div ref={setNodeRef} style={style}>
      {children(dragHandleProps, isDragging)}
    </div>
  );
}

function EpicDetail({
  projectId,
  epic,
  sprints,
  terms,
  canManage,
  busy,
  startInEdit,
  startEditSprintId,
  startAddSprint,
  run,
  api,
  collabToken,
  userName,
  onClose,
  onDeleted,
}: {
  projectId: string;
  epic: EditableEpic;
  sprints: EditableSprint[];
  terms: EpicTermOption[];
  canManage: boolean;
  busy: boolean;
  // When true the detail panel opens with the epic edit form already
  // expanded. The default open is a read view; deep flows that mean "edit
  // now" (and the sprint entry points below) opt in.
  startInEdit: boolean;
  // When set, opens with this sprint's edit form already expanded (entered by
  // clicking a nested sprint row in the epic list).
  startEditSprintId: string | null;
  // When true, scroll the Sprints block into view (from "Add one" in the list).
  startAddSprint: boolean;
  run: (fn: () => Promise<void>) => void;
  api: (url: string, method: "POST" | "DELETE", body?: unknown) => Promise<void>;
  collabToken: string | null;
  userName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  // The modal opens as a read view by default; "editing" switches on the
  // edit affordances (title input, details form, story/sprint editing, live
  // description). Deep flows that arrive to edit — startInEdit, a nested
  // sprint row, "Add one" — start with it on.
  const [editing, setEditing] = useState(
    canManage && (startInEdit || startEditSprintId != null || startAddSprint),
  );
  // Editing a sprint takes precedence over the epic-edit form so opening from
  // a nested sprint row lands directly on that sprint. Opening to add a sprint
  // skips the epic-edit form and scrolls to Sprints instead.
  const [editEpicOpen, setEditEpicOpen] = useState(
    canManage && startInEdit && !startEditSprintId && !startAddSprint,
  );
  // startAddSprint opens the sprint form outright, not just a scroll: both of
  // its entry points ("Add one" in the list, and landing here right after
  // creating an epic) mean "I want to add a sprint now".
  const [newSprintOpen, setNewSprintOpen] = useState(canManage && startAddSprint);
  const [sprintsOpen, setSprintsOpen] = useState(true);
  const [editSprintId, setEditSprintId] = useState<string | null>(
    canManage ? startEditSprintId : null,
  );
  const [newStoryOpen, setNewStoryOpen] = useState(false);
  const [editStoryId, setEditStoryId] = useState<string | null>(null);
  // Draft title while editing details — lives in the header where the name
  // normally sits (no second title field in the form below).
  const [draftTitle, setDraftTitle] = useState(epic.title);
  useEffect(() => setDraftTitle(epic.title), [epic.id, epic.title]);
  // The epic's collab room name. Already populated for epics that have been
  // opened in edit mode before; null otherwise (auto-provisioned on open if
  // the user has edit perms, via POST /api/epics/:id/description-doc).
  const [descriptionDocId, setDescriptionDocId] = useState<string | null>(
    epic.descriptionDocId,
  );
  useEffect(() => {
    // Already provisioned (this epic, or any past visit by anyone) — nothing
    // to do; the editor mounts on the existing room name.
    if (descriptionDocId) return;
    // Viewers can't trigger the write — they'd just see a "No description
    // yet" placeholder until a manager opens the epic. That's fine.
    if (!canManage) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/epics/${epic.id}/description-doc`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { descriptionDocId?: string };
        if (!cancelled && body.descriptionDocId) {
          setDescriptionDocId(body.descriptionDocId);
        }
      } catch {
        // Network failure: the modal still shows the rest of the epic;
        // the description block falls back to "No description yet." A
        // future open retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [descriptionDocId, canManage, epic.id]);

  // Sprints sit at the bottom of the scroll container — jump there when
  // opening a specific sprint to edit, or when arriving via "Add one".
  const sprintsRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!startEditSprintId && !startAddSprint) return;
    // Defer one frame so the modal + collapsed sections have laid out.
    const id = requestAnimationFrame(() => {
      sprintsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [startEditSprintId, startAddSprint]);

  // Story/sprint edit affordances show only while the modal is in edit mode.
  const canEditContent = canManage && editing;

  return (
    <div className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
      {/* Modal header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editEpicOpen ? (
            <input
              id="epic-detail-title"
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              aria-label="Epic name"
              className="w-full font-heading text-lg font-bold text-foreground bg-transparent border-b border-border focus:border-accent-coral focus:outline-none px-0 py-0.5"
            />
          ) : (
            <h2
              id="epic-detail-title"
              className="font-heading text-lg font-bold text-foreground truncate"
            >
              {epic.title}
            </h2>
          )}
          {!editEpicOpen && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="px-1.5 py-0.5 rounded-full border border-border bg-muted/30">
                {epic.status}
              </span>
              {epic.startsAt && epic.endsAt && (
                <span>
                  {dateInputValue(epic.startsAt)} → {dateInputValue(epic.endsAt)}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {canManage && !editing && (
            <Tooltip label="Edit epic">
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setEditEpicOpen(true);
                }}
                aria-label="Edit epic"
                className="text-muted-foreground hover:text-accent-coral"
              >
                <Pencil className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
          {canManage && (
            <Tooltip label="Delete epic">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete epic "${epic.title}"? Its sprints and tasks will be unlinked; its user stories will be deleted.`,
                    )
                  )
                    return;
                  run(async () => {
                    await api(`/api/epics/${epic.id}`, "DELETE");
                    onDeleted();
                  });
                }}
                aria-label="Delete epic"
                className="text-destructive hover:text-destructive/80 disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* Epic details (status / dates) — title edits in the header above.
          Description is a separate collab editor below. Edit mode only: the
          read view already shows status + dates in the header. */}
      {editing && (
      <section className="bg-card border border-border rounded-lg p-4">
        {editEpicOpen ? (
          <EpicForm
            busy={busy}
            initial={epic}
            terms={terms}
            title={draftTitle}
            hideTitle
            onCancel={() => {
              setDraftTitle(epic.title);
              setEditEpicOpen(false);
            }}
            onSubmit={(values) =>
              run(async () => {
                await api(`/api/epics/${epic.id}`, "POST", values);
                setEditEpicOpen(false);
              })
            }
          />
        ) : (
          <div className="flex items-center justify-between text-xs">
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <span>Status: <span className="text-foreground">{epic.status}</span></span>
              {epic.targetTermId && (
                <span>
                  Target term:{" "}
                  <span className="text-foreground">
                    {terms.find((t) => t.id === epic.targetTermId)?.code ??
                      "—"}
                  </span>
                </span>
              )}
              {epic.startsAt && (
                <span>
                  Start:{" "}
                  <span className="text-foreground">
                    {dateInputValue(epic.startsAt)}
                  </span>
                </span>
              )}
              {epic.endsAt && (
                <span>
                  End:{" "}
                  <span className="text-foreground">
                    {dateInputValue(epic.endsAt)}
                  </span>
                </span>
              )}
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => setEditEpicOpen(true)}
                className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
              >
                Edit details
              </button>
            )}
          </div>
        )}
      </section>
      )}

      {/* Description — always live as a collab editor (the project's
          Overview/PRD pattern). The room name is the epic's descriptionDocId
          (lazily provisioned on first open by a manager). For viewers or
          while provisioning is in flight, falls back to a quiet placeholder
          so the modal isn't empty. */}
      <section className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-2">Description</h3>
        {descriptionDocId && collabToken ? (
          <PresenceProvider
            pageId={`epic:${descriptionDocId}`}
            token={collabToken}
            userName={userName}
          >
            <CollaborativeEditor
              editorId={`epic:${descriptionDocId}:description`}
              documentName={`epic:${descriptionDocId}:description`}
              token={collabToken}
              userName={userName}
              disabled={!canEditContent}
              placeholder="What is this epic about?"
              className="border border-border rounded-md"
            />
          </PresenceProvider>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            {canManage
              ? "Preparing editor…"
              : collabToken
                ? "No description yet."
                : "Sign in again to see the description."}
          </p>
        )}
      </section>

      {/* User stories */}
      <section className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">User stories</h3>
          {canEditContent && !newStoryOpen && (
            <button
              type="button"
              onClick={() => setNewStoryOpen(true)}
              className="text-xs font-medium text-accent-coral hover:underline"
            >
              + New story
            </button>
          )}
        </div>

        {newStoryOpen && (
          <StoryForm
            busy={busy}
            onCancel={() => setNewStoryOpen(false)}
            onSubmit={(values) =>
              run(async () => {
                await api(`/api/epics/${epic.id}/stories`, "POST", values);
                setNewStoryOpen(false);
              })
            }
          />
        )}

        {epic.stories.length === 0 && !newStoryOpen ? (
          <p className="text-sm text-muted-foreground italic">No user stories yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {epic.stories.map((story) =>
              editStoryId === story.id ? (
                <div key={story.id} className="py-2">
                  <StoryForm
                    busy={busy}
                    initial={story}
                    onCancel={() => setEditStoryId(null)}
                    onSubmit={(values) =>
                      run(async () => {
                        await api(`/api/stories/${story.id}`, "POST", values);
                        setEditStoryId(null);
                      })
                    }
                  />
                </div>
              ) : (
                <div
                  key={story.id}
                  className="py-2 flex items-start justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <span className="text-foreground">{story.title}</span>
                    {story.notes && (
                      <p className="text-[11px] text-muted-foreground whitespace-pre-wrap mt-0.5">
                        {story.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-muted-foreground">{story.status}</span>
                    {canEditContent && (
                      <>
                        <Tooltip label="Edit story">
                          <button
                            type="button"
                            onClick={() => setEditStoryId(story.id)}
                            aria-label="Edit story"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip label="Delete story">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`Delete story "${story.title}"?`)) return;
                              run(() => api(`/api/stories/${story.id}`, "DELETE"));
                            }}
                            aria-label="Delete story"
                            className="text-destructive hover:text-destructive/80 disabled:opacity-60"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* Sprints scoped to this epic. (Every sprint — including epic-less
          ones — is also listed in the all-sprints section on the main view.) */}
      <section ref={sprintsRef} className="bg-card border border-border rounded-lg p-4">
        <div className={`flex items-center justify-between gap-2 ${sprintsOpen ? "mb-3" : ""}`}>
          <button
            type="button"
            onClick={() => setSprintsOpen((o) => !o)}
            aria-expanded={sprintsOpen}
            className="flex items-center gap-1.5 min-w-0"
          >
            <span
              aria-hidden
              className={`inline-block text-muted-foreground transition-transform ${sprintsOpen ? "rotate-90" : ""}`}
            >
              ›
            </span>
            <h3 className="text-sm font-semibold text-foreground">Sprints</h3>
          </button>
          {canEditContent && !newSprintOpen && (
            <button
              type="button"
              onClick={() => {
                setSprintsOpen(true);
                setNewSprintOpen(true);
              }}
              className="text-xs font-medium text-accent-coral hover:underline"
            >
              + New sprint
            </button>
          )}
        </div>

        {sprintsOpen && (
          <>
        {newSprintOpen && (
          <SprintForm
            busy={busy}
            onCancel={() => setNewSprintOpen(false)}
            onSubmit={(values) =>
              run(async () => {
                await api(`/api/projects/${projectId}/sprints`, "POST", {
                  ...values,
                  epicId: epic.id,
                });
                setNewSprintOpen(false);
              })
            }
          />
        )}

        {sprints.length === 0 && !newSprintOpen ? (
          <p className="text-sm text-muted-foreground italic">
            No sprints in this epic yet.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {sprints.map((sprint) =>
              editSprintId === sprint.id ? (
                <div key={sprint.id} className="py-2">
                  <SprintForm
                    busy={busy}
                    initial={sprint}
                    onCancel={() => setEditSprintId(null)}
                    onSubmit={(values) =>
                      run(async () => {
                        await api(`/api/sprints/${sprint.id}`, "POST", values);
                        setEditSprintId(null);
                      })
                    }
                    onDelete={() => {
                      if (
                        !window.confirm(
                          `Delete sprint "${sprint.name}"? Its tasks move back to the backlog.`,
                        )
                      )
                        return;
                      run(async () => {
                        await api(`/api/sprints/${sprint.id}`, "DELETE");
                        setEditSprintId(null);
                      });
                    }}
                  />
                </div>
              ) : (
                <div
                  key={sprint.id}
                  className="py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <span className="text-foreground">{sprint.name}</span>
                    <span className="text-[11px] text-muted-foreground ml-2">
                      {dateInputValue(sprint.startsAt)} → {dateInputValue(sprint.endsAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-muted-foreground">{sprint.status}</span>
                    {canEditContent && (
                      <Tooltip label="Edit sprint">
                        <button
                          type="button"
                          onClick={() => setEditSprintId(sprint.id)}
                          aria-label="Edit sprint"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
          </>
        )}
      </section>
    </div>
  );
}

function EpicForm({
  initial,
  busy,
  terms,
  onSubmit,
  onCancel,
  hideTitle = false,
  title: titleProp,
}: {
  initial?: EditableEpic;
  busy: boolean;
  terms: EpicTermOption[];
  onSubmit: (values: {
    title: string;
    status: string;
    targetTermId: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }) => void;
  onCancel: () => void;
  /** When true, title is edited elsewhere (e.g. modal header) via `title`. */
  hideTitle?: boolean;
  title?: string;
}) {
  const [titleInternal, setTitleInternal] = useState(initial?.title ?? "");
  const title = hideTitle ? (titleProp ?? "") : titleInternal;
  const [status, setStatus] = useState(initial?.status ?? "Open");
  const [targetTermId, setTargetTermId] = useState(initial?.targetTermId ?? "");
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? dateInputValue(initial.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(
    initial?.endsAt ? dateInputValue(initial.endsAt) : "",
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title,
          status,
          // Empty → null clears the target term.
          targetTermId: targetTermId || null,
          // Dates are optional for epics; empty → null clears the field.
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        });
      }}
      className="flex flex-col gap-2 mb-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        {!hideTitle && (
          <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]">
            <span className="text-muted-foreground">Title</span>
            <input
              autoFocus
              value={titleInternal}
              onChange={(e) => setTitleInternal(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EditableEpic["status"])}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          >
            {EPIC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {/* Optional target term — a planning signal for cross-term epics, not
            a hard scope. Only offered once the project has terms. */}
        {terms.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Target term (optional)</span>
            <select
              value={targetTermId}
              onChange={(e) => setTargetTermId(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            >
              <option value="">No target term</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                </option>
              ))}
            </select>
          </label>
        )}
        {/* Start + End stay paired on one line even when the row wraps. */}
        <div className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Start (optional)</span>
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">End (optional)</span>
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </label>
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={busy}
        >
          {/* Creating a new epic hands off to the detail modal to add
              sprints/stories, so "Next" signals there's more after this. */}
          {initial ? "Save" : "Next"}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SprintForm({
  initial,
  busy,
  epics,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial?: EditableSprint;
  busy: boolean;
  // When provided (the all-sprints section), renders an optional epic picker
  // and includes `epicId` in the submitted values (null = no epic). Omitted
  // inside the epic detail modal, where the epic is implied by context.
  epics?: { id: string; title: string }[];
  onSubmit: (values: {
    name: string;
    startsAt: string;
    endsAt: string;
    status: string;
    epicId?: string | null;
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startsAt, setStartsAt] = useState(
    initial ? dateInputValue(initial.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(initial ? dateInputValue(initial.endsAt) : "");
  const [status, setStatus] = useState(initial?.status ?? "Planned");
  // "" = no epic; only meaningful when the picker is shown.
  const [epicId, setEpicId] = useState(initial?.epicId ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name,
          // Date inputs are date-only; send as ISO so the API's new Date()
          // parses them at UTC midnight.
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          status,
          ...(epics ? { epicId: epicId || null } : {}),
        });
      }}
      className="flex items-end gap-2 mb-3"
    >
      <div className="flex flex-wrap items-end gap-2 flex-1 min-w-0">
      <label className="flex flex-col gap-1 text-xs flex-1 min-w-[160px]">
        <span className="text-muted-foreground">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Start</span>
        <input
          type="date"
          required
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">End</span>
        <input
          type="date"
          required
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Status</span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EditableSprint["status"])}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
        >
          {SPRINT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {epics && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Epic (optional)</span>
          <select
            value={epicId}
            onChange={(e) => setEpicId(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          >
            <option value="">No epic</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
      )}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="submit"
          disabled={busy}
          title="Save"
          aria-label="Save"
          className="p-1.5 rounded text-accent-coral hover:bg-accent-coral/10 disabled:opacity-60"
        >
          <Check className="w-4 h-4" />
        </button>
        {onDelete && (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            title="Delete sprint"
            aria-label="Delete sprint"
            className="p-1.5 rounded text-destructive hover:bg-destructive/10 disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          aria-label="Cancel"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;

function StoryForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: EditableStory;
  busy: boolean;
  onSubmit: (values: {
    title: string;
    notes: string | null;
    status: string;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [status, setStatus] = useState(initial?.status ?? "Todo");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title,
          // Empty → null clears the notes.
          notes: notes.trim() ? notes.trim() : null,
          status,
        });
      }}
      className="flex flex-col gap-2 mb-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]">
          <span className="text-muted-foreground">
            Story (e.g. “As a user, I can …”)
          </span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EditableStory["status"])}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
          >
            {STORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Notes / acceptance (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>
      <div className="flex gap-1.5">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={busy}
        >
          Save
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
