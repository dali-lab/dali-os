import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { Select, Tooltip, InfoTip } from "~/components/ui/floating";
import {
  X,
  Trash2,
  Pencil,
  Plus,
  CheckSquare,
  FileText,
  Zap,
  Calendar,
  Ban,
  RotateCcw,
  GanttChart,
  List,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { Modal } from "~/components/Modal";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import {
  EpicsTimeline,
  LEVEL_COLOR,
  TASK_STATUS_LABEL,
  type TimelineEpic,
  type TimelineSprint,
} from "./EpicsTimeline";
import { EpicList } from "./EpicList";
import type { EpicDerivedStatus } from "../lib/sprints";

// MoSCoW priority for a product requirement (story). Null = unset.
export type StoryPriority = "Must" | "Should" | "Could" | "Wont";

export type EditableStory = {
  id: string;
  title: string;
  notes: string | null;
  status: "Todo" | "InProgress" | "Done";
  successMetric: string | null;
  acceptanceCriteria: string | null;
  category: string | null;
  priority: StoryPriority | null;
};

export type EditableEpicTask = {
  id: string;
  title: string;
  status: "Todo" | "InProgress" | "InReview" | "Done" | "Cancelled" | "Backlog";
  // "Sprint 4", or null in the backlog.
  sprint: string | null;
};

export type EditableEpic = {
  id: string;
  title: string;
  description: string | null;
  // Derived from the epic's tasks; Cancelled is the one hand-set state.
  status: EpicDerivedStatus;
  descriptionDocId: string | null;
  // Labels of the sprints holding its tasks, in order.
  sprints: string[];
  tasks: EditableEpicTask[];
  stories: EditableStory[];
};

// A term option for the list view's term filter. Newest first.
export type EpicTermOption = { id: string; code: string };

export const EPIC_DERIVED_LABEL: Record<EpicDerivedStatus, string> = {
  NotStarted: "Not started",
  InProgress: "In progress",
  Done: "Done",
  Cancelled: "Cancelled",
};
const STORY_PRIORITIES: StoryPriority[] = ["Must", "Should", "Could", "Wont"];

/** A story captured by name and not yet filled in — the design's amber dot. */
export function isStoryIncomplete(st: {
  notes: string | null;
  successMetric: string | null;
  acceptanceCriteria: string | null;
}): boolean {
  return !st.notes && !st.successMetric && !st.acceptanceCriteria;
}

// Shared control styling for the epic detail rows, so the read and edit
// affordances occupy the same box.
const EPIC_FIELD =
  "w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40";
const STORY_PRIORITY_TONE: Record<StoryPriority, string> = {
  Must: "text-accent-coral font-semibold",
  Should: "text-foreground",
  Could: "text-muted-foreground",
  Wont: "text-muted-foreground line-through",
};

type Props = {
  projectId: string;
  epics: EditableEpic[];
  // Terms the project's work falls in (newest first) — the list view's term
  // filter options.
  terms: EpicTermOption[];
  canManage: boolean;
  // Hocuspocus WebSocket auth token; userName labels the presence cursor.
  // Both are forwarded into the EpicDetail modal where the description
  // collab DocEditor lives. Null token = signed-out / no-cookie state;
  // the editor's read-only fallback handles it.
  collabToken: string | null;
  userName: string;
  // TimelineEpic shape for the timeline body.
  timelineEpics?: TimelineEpic[];
  // The project's stored sprints — the timeline's header bands.
  sprints?: TimelineSprint[];
  // Terms each epic counts toward, keyed by epic id — the same date-derived
  // footprint the board's term filter uses, computed in the loader. Drives the list view's term filter.
  epicTermIds?: Record<string, string[]>;
  // The term "now" falls in, when the project runs it. The list view opens on
  // it; null falls back to all terms.
  currentTermId?: string | null;
  // Opens a task from a timeline task bar. Left to the caller because the task
  // modal lives on the board (?task=), not in this component.
  onTaskClick?: (taskId: string) => void;
  // Opens the task board's create form, optionally filed under an epic.
  // Provided only where a board is on the same surface (the os Progress tab).
  onAddTask?: (link?: { epicId: string; reopenEpicId?: string }) => void;
  // An epic to put back on screen — set by the caller once a task form this
  // component closed for has itself closed. A fresh object per request, so
  // reopening the same epic twice still re-fires.
  reopenEpic?: { epicId: string } | null;
};

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

// One row of the design's add-menu: glyph, white label, container fill on
// hover. Each item carries its own icon so the New menu reads at a glance
// (a task check, a story doc, an epic bolt, a meeting calendar).
function AddMenuItem({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-os-container"
    >
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-os-accent">
        {icon ?? <Plus className="h-4 w-4" aria-hidden />}
      </span>
      {label}
    </button>
  );
}

export function EpicSprintManager({
  projectId,
  epics,
  terms,
  canManage,
  collabToken,
  userName,
  timelineEpics = [],
  sprints = [],
  epicTermIds,
  currentTermId,
  onTaskClick,
  onAddTask,
  reopenEpic = null,
}: Props) {
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newEpicOpen, setNewEpicOpen] = useState(false);
  // Timeline or outline. The two show the same tree; the grid places it in
  // time, the list folds it up so an epic's stories and tasks read at a glance.
  const [view, setView] = useState<EpicView>("timeline");
  // Fullscreen belongs to the timeline alone: the grid is the one view here
  // wide enough to be worth the whole viewport, and the outline already reads
  // fine in the page's column. Switching views drops it (effect below).
  const [fullscreen, setFullscreen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  // Second level of the Add menu: "User story" has to be told which epic it
  // belongs to, so picking it lists the epics rather than guessing one.
  const [addStoryPicking, setAddStoryPicking] = useState(false);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  // The selected epic opens its detail view in a modal over the timeline.
  const [openEpicId, setOpenEpicId] = useState<string | null>(null);
  // Which epic to open with its new-story form already up (Add ▸ User story).
  const [autoNewStoryEpicId, setAutoNewStoryEpicId] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "timeline") setFullscreen(false);
  }, [view]);

  // Escape leaves fullscreen. A modal over the timeline gets the key first —
  // both handlers sit on `document`, so the modal's stopPropagation never
  // reaches this one and Escape would otherwise close the modal and drop
  // fullscreen in the same press.
  const modalOpen = newEpicOpen || openEpicId != null;
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !modalOpen) setFullscreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullscreen, modalOpen]);

  // Freeze the page under the overlay so a scroll that falls off the grid
  // doesn't move it. Kept apart from the key handler above: this has to latch
  // the pre-fullscreen value once, not re-latch whatever a modal left behind.
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
        setAddStoryPicking(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddMenuOpen(false);
        setAddStoryPicking(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [addMenuOpen]);

  function openEpic(epicId: string) {
    setOpenEpicId(epicId);
  }

  function closeEpic() {
    setOpenEpicId(null);
  }

  // Put the epic back once the task form it stepped aside for is done with —
  // adding a second task to the same story shouldn't mean finding the epic
  // again. Only the add that closed this modal asks for it (reopenEpicId); the
  // outline's own add covered nothing, so nothing reopens there.
  useEffect(() => {
    if (reopenEpic) setOpenEpicId(reopenEpic.epicId);
  }, [reopenEpic]);

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    return fn()
      .then(() => revalidator.revalidate())
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Something went wrong");
        throw e;
      })
      .finally(() => setBusy(false));
  }

  const errorBanner = error && (
    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
      {error}
    </div>
  );

  // The selected epic's detail view is rendered inside a modal over the list.
  // It survives revalidation because we look the epic up fresh each render.
  const activeEpic = openEpicId ? epics.find((e) => e.id === openEpicId) : null;

  // The Progress toolbar controls ride on whichever view is up, in its header
  // row — right of the timeline's level legend (Epics / User stories / Tasks)
  // or of the list's filters, via the same `actions` slot. The view toggle is
  // everyone's and sits last, past New; Edit (drag the bars, timeline only) and
  // the Add menu need manage rights. The people filter used to sit here too and sliced the
  // timeline; it now lives on the task board beside its search and only
  // narrows the board's tasks.
  const progressActions = (
    <div className="flex items-center gap-2.5">
      {view === "timeline" && (
        <button
          type="button"
          className="os-edit-btn"
          aria-pressed={fullscreen}
          onClick={() => setFullscreen((v) => !v)}
          title={
            fullscreen
              ? "Exit fullscreen (Esc)"
              : "Fill the screen with the timeline"
          }
        >
          {fullscreen ? (
            <Minimize2 className="h-[15px] w-[15px]" aria-hidden />
          ) : (
            <Maximize2 className="h-[15px] w-[15px]" aria-hidden />
          )}
          {fullscreen ? "Exit" : "Fullscreen"}
        </button>
      )}

      {canManage && (
        <div ref={addMenuRef} className="relative">
          <button
            type="button"
            className="os-add-btn"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            onClick={() => {
              setAddMenuOpen((v) => !v);
              setAddStoryPicking(false);
            }}
          >
            <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
            New
          </button>
          {addMenuOpen && (
            <div
              role="menu"
              className="absolute top-[calc(100%+8px)] right-0 z-[100] max-h-72 min-w-[200px] overflow-y-auto rounded-xl border border-os-container bg-os-card p-1.5 shadow-[0_12px_32px_var(--color-os-shadow)]"
            >
              {addStoryPicking ? (
                epics.length === 0 ? (
                  <p className="px-2.5 py-2 text-sm text-os-muted">
                    No epics yet — add one first.
                  </p>
                ) : (
                  <>
                    <p className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-os-muted">
                      Add story to
                    </p>
                    {epics.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2.5 truncate rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-os-container"
                        onClick={() => {
                          setAddMenuOpen(false);
                          setAddStoryPicking(false);
                          setAutoNewStoryEpicId(e.id);
                          openEpic(e.id);
                        }}
                      >
                        <span className="truncate">{e.title}</span>
                      </button>
                    ))}
                  </>
                )
              ) : (
                <>
                  {onAddTask && (
                    <AddMenuItem
                      label="Task"
                      icon={<CheckSquare className="h-4 w-4" aria-hidden />}
                      onClick={() => {
                        setAddMenuOpen(false);
                        onAddTask();
                      }}
                    />
                  )}
                  <AddMenuItem
                    label="User story"
                    icon={<FileText className="h-4 w-4" aria-hidden />}
                    onClick={() => setAddStoryPicking(true)}
                  />
                  <AddMenuItem
                    label="Epic"
                    icon={<Zap className="h-4 w-4" aria-hidden />}
                    onClick={() => {
                      setAddMenuOpen(false);
                      setNewEpicOpen(true);
                    }}
                  />
                  <AddMenuItem
                    label="Meeting"
                    icon={<Calendar className="h-4 w-4" aria-hidden />}
                    onClick={() => {
                      setAddMenuOpen(false);
                      navigate(`/calendar?compose=meeting&project=${projectId}`);
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      <ViewToggle value={view} onChange={setView} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {errorBanner}

      {/* New epic. On save we immediately reopen as the real detail modal for
          the created epic (see onSubmit), so stories and a description can be
          added right away. Narrower than the detail modal — there are no story
          cards to lay out yet. */}
      <Modal
        open={newEpicOpen}
        onClose={() => setNewEpicOpen(false)}
        labelledBy="new-epic-title"
        disableEscape={busy}
        containerClassName="w-full max-w-[560px] my-auto os-modal-card os-form"
      >
        {/* Eyebrow rather than a heading: the form's own name field is the
            prominent title, exactly as in the detail modal. Under os the
            level moves onto the design's type badge and the heading names the
            dialog, so the epic's own name can be a field with a required mark
            on it. */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex min-w-0 items-center gap-2">
              <span className="os-type-badge os-type-badge--epic flex-shrink-0">Epic</span>
              <h2 id="new-epic-title" className="os-modal-title min-w-0 truncate">
                New epic
              </h2>
            </div>
          <button
            type="button"
            onClick={() => setNewEpicOpen(false)}
            aria-label="Close"
            className="os-icon-btn"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <EpicForm
          busy={busy}
          onCancel={() => setNewEpicOpen(false)}
          onSubmit={(values) =>
            run(async () => {
              const created = await apiJson<{ id: string }>(
                `/api/projects/${projectId}/epics`,
                "POST",
                values,
              );
              setNewEpicOpen(false);
              // Hand straight off to the detail modal so stories and dates can
              // be filled in without a second click. `openEpic` only sets the
              // id; the modal renders once the revalidate in `run` lands the
              // new row in `epics`.
              openEpic(created.id);
            })
          }
        />
      </Modal>

      <Modal
        open={activeEpic != null}
        onClose={closeEpic}
        labelledBy="epic-detail-title"
        disableEscape={busy}
        containerClassName="w-full max-w-[560px] my-auto os-modal-card os-form"
      >
        {activeEpic && (
          <EpicDetail
            projectId={projectId}
            epic={activeEpic}
            autoNewStory={autoNewStoryEpicId === activeEpic.id}
            onOpenTask={onTaskClick}
            canManage={canManage}
            busy={busy}
            run={run}
            api={api}
            collabToken={collabToken}
            userName={userName}
            onClose={() => {
              setAutoNewStoryEpicId(null);
              closeEpic();
            }}
            onDeleted={closeEpic}
            onAddTask={
              onAddTask
                ? () => {
                    closeEpic();
                    onAddTask({ epicId: activeEpic.id, reopenEpicId: activeEpic.id });
                  }
                : undefined
            }
          />
        )}
      </Modal>

      {/* Clicking an epic or story bar opens the detail/edit modal; a task bar
          defers to the caller, which opens the board's task modal via ?task=.
          The Edit/New controls (os) and the classic "+ Add epic" button ride in
          the timeline's own header row, right of the level legend. */}
      {view === "timeline" ? (
        // Fullscreen keeps the same timeline mounted inside a fixed shell, so
        // the legend toggles, scroll position and any drag in flight survive
        // the switch. Below the Modals' z-50 on purpose: an epic opened from a
        // fullscreen bar still draws over the grid.
        <div
          className={cn(
            fullscreen && "fixed inset-0 z-40 flex flex-col bg-background p-4 sm:p-6",
          )}
        >
          <EpicsTimeline
            epics={timelineEpics}
            sprints={sprints}
            hiddenLevels={["story"]}
            actions={progressActions}
            fillHeight={fullscreen}
            onEpicClick={canManage ? (id) => openEpic(id) : undefined}
            onStoryClick={canManage ? (epicId) => openEpic(epicId) : undefined}
            onTaskClick={onTaskClick}
          />
        </div>
      ) : (
        <EpicList
          epics={timelineEpics}
          terms={terms}
          epicTermIds={epicTermIds}
          currentTermId={currentTermId}
          actions={progressActions}
          onEpicClick={canManage ? (id) => openEpic(id) : undefined}
          onStoryClick={canManage ? (epicId) => openEpic(epicId) : undefined}
          onTaskClick={onTaskClick}
          onAddTask={
            canManage && onAddTask ? (epicId) => onAddTask({ epicId }) : undefined
          }
        />
      )}
    </div>
  );
}

export function EpicDetail({
  projectId,
  epic,
  autoNewStory = false,
  onOpenTask,
  canManage,
  busy,
  run,
  api,
  collabToken,
  userName,
  onClose,
  onDeleted,
  onAddTask,
}: {
  projectId: string;
  epic: EditableEpic;
  // Open with the new-story form already up — Add ▸ User story lands here.
  autoNewStory?: boolean;
  // Opens one of the epic's tasks on the board.
  onOpenTask?: (taskId: string) => void;
  canManage: boolean;
  busy: boolean;
  run: (fn: () => Promise<void>) => void;
  api: (url: string, method: "POST" | "DELETE", body?: unknown) => Promise<void>;
  collabToken: string | null;
  userName: string;
  onClose: () => void;
  onDeleted: () => void;
  // Files a task under this epic. Omitted where there is no board to receive
  // it (the partner hub), which hides the affordance.
  onAddTask?: () => void;
}) {
  const dialog = useDialog();
  const [newStoryOpen, setNewStoryOpen] = useState(Boolean(autoNewStory));
  const [quickAddTitle, setQuickAddTitle] = useState("");
  // Quick-add appends to the end of a list that may already be taller than the
  // modal, so the row you just typed can land off-screen. Scroll to it when the
  // count grows — on growth only, so an unrelated revalidate doesn't yank the
  // modal around while you're reading it.
  const storyListRef = useRef<HTMLUListElement | null>(null);
  const storyCountRef = useRef(epic.stories.length);
  useEffect(() => {
    const grew = epic.stories.length > storyCountRef.current;
    storyCountRef.current = epic.stories.length;
    if (!grew) return;
    storyListRef.current?.lastElementChild?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [epic.stories.length]);
  const [editStoryId, setEditStoryId] = useState<string | null>(null);
  // The epic name is edited in place in the header (there's no title field in
  // the details form below). Committed on blur/Enter.
  const [draftTitle, setDraftTitle] = useState(epic.title);
  useEffect(() => setDraftTitle(epic.title), [epic.id, epic.title]);

  function saveEpic(values: Record<string, unknown>) {
    run(() => api(`/api/epics/${epic.id}`, "POST", values));
  }

  async function saveTitle() {
    const next = draftTitle.trim();
    if (!next) {
      setDraftTitle(epic.title);
      return;
    }
    if (next === epic.title) return;
    run(() => api(`/api/epics/${epic.id}`, "POST", { title: next }));
  }
  // The epic's collab room name. Already populated for epics that have been
  // opened in edit mode before; null otherwise (auto-provisioned on open if
  // the user has edit perms, via POST /api/epics/:id/description-doc).
  const [descriptionDocId, setDescriptionDocId] = useState<string | null>(
    epic.descriptionDocId,
  );
  useEffect(() => {
    // Viewers can't trigger the write — they'd just see the plain-text
    // description (or a placeholder) until a manager opens the epic.
    if (!canManage) return;
    // Ping on every manager open, even when the room name is already known:
    // the endpoint is idempotent for the id and also seeds the doc from a
    // legacy plain-text description if the doc is still empty, so an epic
    // provisioned-but-empty before that seeding existed still gets migrated.
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
        // the description block falls back to the plain text or a
        // placeholder. A future open retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage, epic.id]);

  // There is no modal-level edit mode: a manager can add a story, rename the
  // epic, or open the details form straight from the read view.
  const canEditContent = canManage;

  return (
    <div className="max-h-[80vh] overflow-y-auto">
      {/* Modal header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* The level is named with a badge, not marked with a dot. */}
            <span className="os-type-badge os-type-badge--epic flex-shrink-0">Epic</span>
            {canManage ? (
              <input
                id="epic-detail-title"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === "Escape") {
                    setDraftTitle(epic.title);
                  }
                }}
                aria-label="Epic name"
                className={cn(
                  "os-record-name w-full font-heading text-lg font-bold text-foreground bg-transparent rounded px-1 -mx-1 py-0.5 hover:bg-muted/40 focus:bg-transparent focus:outline-none focus:ring-2 focus:ring-accent-coral/30",
                )}
              />
            ) : (
              <h2
                id="epic-detail-title"
                className="os-record-name font-heading text-lg font-bold text-foreground truncate"
              >
                {epic.title}
              </h2>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {canManage && (
            <Tooltip content="Delete epic">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    !(await dialog.confirm({
                      title: `Delete epic "${epic.title}"?`,
                      description:
                        "Its tasks move to the project's General epic; its user stories are deleted.",
                      confirmLabel: "Delete",
                      tone: "destructive",
                    }))
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

      <section>
        <div className="os-field-row">
          <div className="os-field-group">
            <span className="os-field-label">
              Status{" "}
              <InfoTip content="Follows the epic's tasks: In progress once any has started, Done when all are Done or Cancelled." />
            </span>
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground">{EPIC_DERIVED_LABEL[epic.status]}</span>
              {canManage && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => saveEpic({ cancelled: epic.status !== "Cancelled" })}
                  className="inline-flex items-center gap-1 text-xs text-os-grey hover:text-foreground disabled:opacity-60"
                >
                  {epic.status === "Cancelled" ? (
                    <>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reopen epic
                    </>
                  ) : (
                    <>
                      <Ban className="h-3.5 w-3.5" aria-hidden /> Cancel epic
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="os-field-group">
          <span className="os-field-label">Sprints</span>
          {epic.sprints.length > 0 ? (
            <div className="os-sprint-chip-row">
              {epic.sprints.map((label) => (
                <span key={label} className="os-sprint-chip os-sprint-chip--active">
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-os-grey">
              Put one of its tasks in a sprint to place this epic on the timeline.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="os-section-header">Tasks ({epic.tasks.length})</h3>
          {canEditContent && onAddTask && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAddTask()}
              className="inline-flex items-center gap-1 text-xs text-os-grey hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> Add task
            </button>
          )}
        </div>
        {epic.tasks.length === 0 ? (
          <p className="text-sm text-os-grey">No tasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {epic.tasks.map((t) => (
              <li key={t.id} className="os-item-row">
                <button
                  type="button"
                  onClick={onOpenTask ? () => onOpenTask(t.id) : undefined}
                  disabled={!onOpenTask}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="truncate">{t.title}</span>
                </button>
                <span className="flex-shrink-0 text-xs text-os-grey">{t.sprint ?? "Backlog"}</span>
                <span className="flex-shrink-0 rounded-full border border-os-container px-2 py-0.5 text-[11px] font-semibold text-os-grey">
                  {TASK_STATUS_LABEL[t.status as keyof typeof TASK_STATUS_LABEL] ?? t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Description — a live collab editor (the project's Overview/PRD
          pattern). The room name is the epic's descriptionDocId (lazily
          provisioned on first manager open, and seeded there from any legacy
          plain-text description). For viewers or while provisioning is in
          flight, falls back to that plain text, then a placeholder — never
          both the text and the editor at once. */}
      <div className="os-modal-divider" aria-hidden />
      <section>
        <h3 className="os-section-header">Description</h3>
        {descriptionDocId && collabToken ? (
          <PresenceProvider
            pageId={`epic:${descriptionDocId}`}
            token={collabToken}
            userName={userName}
          >
            <DocEditor
              collab={{
                documentName: `epic:${descriptionDocId}:description`,
                token: collabToken,
                userName,
              }}
              editable={canEditContent}
              placeholder="What is this epic about?"
              className="rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-accent-coral/30"
            />
          </PresenceProvider>
        ) : epic.description ? (
          // No live editor yet (a viewer, or provisioning still in flight):
          // show the plain-text `description` so the modal isn't empty. When a
          // manager opens the epic the doc is seeded from this same text and
          // the editor above becomes the single surface — the two never stack.
          <p className="mb-3 whitespace-pre-wrap text-sm text-foreground">
            {epic.description}
          </p>
        ) : canManage ? (
          <p className="text-sm text-muted-foreground italic">Preparing editor…</p>
        ) : descriptionDocId && !collabToken ? (
          <p className="text-sm text-muted-foreground italic">
            Sign in again to see the description.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No description yet.</p>
        )}
      </section>

      {/* User stories — card list (not a cramped multi-column table). Notes
          and criteria live in their own blocks so long text doesn't jam into
          the requirement cell. Editing uses the same edit mode as the header
          pencil; each story expands inline rather than a nested table-row form. */}
      <div className="os-modal-divider" aria-hidden />
      <section>
        <div className="flex items-center justify-between mb-3">
          {/* A section is named in type, not with a colour dot. */}
          <h3 className="os-section-header !mb-0 flex items-center gap-2">
            User stories
          </h3>
          {canEditContent && !newStoryOpen && (
            <button
              type="button"
              onClick={() => setNewStoryOpen(true)}
              className="os-add-btn os-add-btn--sm"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
              New story
            </button>
          )}
        </div>

        {newStoryOpen && (
          // The design adds a story by name, in place — .quick-add-input-row
          // under the list. No dialog: you capture five stories without
          // leaving the epic, and each lands marked incomplete until its
          // details are filled in.
          <div className="os-quick-add-row mb-2.5">
            <input
              autoFocus
              value={quickAddTitle}
              onChange={(e) => setQuickAddTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuickAddTitle("");
                  setNewStoryOpen(false);
                  return;
                }
                if (e.key !== "Enter") return;
                e.preventDefault();
                const title = quickAddTitle.trim();
                if (!title) return;
                setQuickAddTitle("");
                run(async () => {
                  await api(`/api/epics/${epic.id}/stories`, "POST", { title });
                });
              }}
              placeholder="Story name, then Enter…"
              aria-label="New story name"
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              className="os-icon-btn"
              aria-label="Done adding"
              onClick={() => {
                setQuickAddTitle("");
                setNewStoryOpen(false);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {epic.stories.length === 0 && !newStoryOpen ? (
          <p className="text-sm text-muted-foreground italic">No user stories yet.</p>
        ) : (
          <ul
            ref={storyListRef}
            className="os-item-list"
          >
            {epic.stories.map((story) => {
              const editing = editStoryId === story.id;
              return (
              // .quick-add-item: the story's name on the left, one × on the
              // right — and, once opened, its form directly underneath.
              <li key={story.id}>
                <div className="os-item-row">
                  <Tooltip content={story.title}>
                    <button
                      type="button"
                      aria-expanded={editing}
                      onClick={() =>
                        canEditContent && setEditStoryId(editing ? null : story.id)
                      }
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {isStoryIncomplete(story) && (
                        <Tooltip
                          variant="rich"
                          content="Quick-captured by name only — open this story to add notes, acceptance criteria, and priority."
                          placement="right"
                        >
                          <span className="os-incomplete-dot">!</span>
                        </Tooltip>
                      )}
                      <span className="truncate">{story.title}</span>
                    </button>
                  </Tooltip>
                  {canEditContent && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${story.title}`}
                      className="flex flex-shrink-0 text-os-grey transition-colors hover:text-os-fg"
                      onClick={async () => {
                        if (
                          !(await dialog.confirm({
                            title: `Delete story "${story.title}"?`,
                            description: "The story's notes and acceptance criteria go with it.",
                            confirmLabel: "Delete",
                            tone: "destructive",
                          }))
                        )
                          return;
                        run(() => api(`/api/stories/${story.id}`, "DELETE"));
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* The story opens where it sits, not in a second dialog over
                    the first: a story belongs to the epic you already have
                    open, and a modal on a modal buries it. */}
                {editing && (
                  <div className="mt-2 rounded-[10px] border border-os-container bg-os-well px-3 pt-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="os-type-badge os-type-badge--story">
                        User story
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditStoryId(null)}
                        aria-label="Close story"
                        className="os-icon-btn"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
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
                )}
              </li>
              );
            })}
          </ul>
        )}

      </section>
    </div>
  );
}

// New-epic form. Deliberately the same shape as the detail modal's header +
// details grid — name at the top behind the epic dot, then the identical
// label/value rows — so creating an epic and editing one look like the same
// screen. It stays a submit form because there's no epic to PATCH into yet.
function EpicForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (values: { title: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title });
      }}
    >
      {/* The design's first field, carrying the mark that says it's the one
          you can't leave blank. */}
      <div className="os-field-group">
        <label htmlFor="new-epic-name" className="os-field-label">
          Name<span className="os-required-mark">*</span>
        </label>
        <input
          id="new-epic-name"
          type="text"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What is this epic?"
          className="w-full"
        />
      </div>

      <p className="os-field-hint">
        An epic is a bucket of work. It shows on the timeline from the first to the last sprint
        holding one of its tasks.
      </p>

      <div className="os-modal-footer">
        <button
          type="button"
          onClick={onCancel}
          className={buttonClasses("secondary", "sm")}
        >
          Cancel
        </button>
        {/* Creating hands off to the detail modal to add stories and a
            description, so "Next" signals there's more after this. */}
        <Button type="submit" variant="primary" size="sm" disabled={busy || !title.trim()}>
          Next
        </Button>
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
    successMetric: string | null;
    acceptanceCriteria: string | null;
    category: string | null;
    priority: StoryPriority | null;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [status, setStatus] = useState(initial?.status ?? "Todo");
  const [successMetric, setSuccessMetric] = useState(initial?.successMetric ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    initial?.acceptanceCriteria ?? "",
  );
  const [category, setCategory] = useState(initial?.category ?? "");
  const [priority, setPriority] = useState<StoryPriority | "">(initial?.priority ?? "");
  // Named once, laid out twice: the design pairs Status with the due date on
  // one row, the classic form runs them along a wrapping strip of fields.
  const nameField = (
    <input
      type="text"
      autoFocus
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      className="w-full"
    />
  );
  const statusField = (
    <Select
      value={status}
      onChange={(value) => setStatus(value as EditableStory["status"])}
      options={STORY_STATUSES.map((st) => ({ value: st, label: st }))}
      buttonClassName="w-full"
    />
  );
  const categoryField = (
    <input
      type="text"
      value={category}
      onChange={(e) => setCategory(e.target.value)}
      placeholder="e.g. Functional"
      className="w-full"
    />
  );
  const notesField = (
    <textarea
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      rows={4}
      className="w-full"
    />
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const clean = (v: string) => (v.trim() ? v.trim() : null);
        onSubmit({
          title,
          notes: clean(notes),
          status,
          successMetric: clean(successMetric),
          acceptanceCriteria: clean(acceptanceCriteria),
          category: clean(category),
          priority: priority || null,
        });
      }}
      className="mb-3"
    >
      <>
        <label className="os-field-group">
          <span>
            Name<span className="os-required-mark">*</span>
          </span>
          {nameField}
        </label>
        <label className="os-field-group">
          <span>Status</span>
          {statusField}
        </label>
        <label className="os-field-group">
          <span>Labels</span>
          {categoryField}
        </label>
        <label className="os-field-group">
          <span>Description</span>
          {notesField}
        </label>
      </>
      <div className="os-modal-footer">
        <button
          type="button"
          onClick={onCancel}
          className={buttonClasses("secondary", "sm")}
        >
          Cancel
        </button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={busy}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

type EpicView = "timeline" | "list";

/** Timeline or outline, in the shape of the hub's list/cards switch — the two
 *  are the same choice (how to read a set of things), so they wear the same
 *  control. Sits with Edit and New rather than with the level legend because
 *  it changes the view, not what the view shows. */
function ViewToggle({
  value,
  onChange,
}: {
  value: EpicView;
  onChange: (next: EpicView) => void;
}) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-full border border-os-container bg-os-card">
      <ViewToggleButton
        active={value === "timeline"}
        onClick={() => onChange("timeline")}
        label="Timeline view"
      >
        <GanttChart className="h-4 w-4" aria-hidden />
      </ViewToggleButton>
      <ViewToggleButton
        active={value === "list"}
        onClick={() => onChange("list")}
        label="List view"
      >
        <List className="h-4 w-4" aria-hidden />
      </ViewToggleButton>
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "px-3.5 py-2.5 transition-colors",
        active ? "bg-os-container text-foreground" : "text-os-grey hover:bg-os-hover",
      )}
    >
      {children}
    </button>
  );
}
