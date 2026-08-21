import { useEffect, useMemo, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Select } from "~/components/ui/floating";
import { X, Trash2, Pencil, Plus } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { Modal } from "~/components/Modal";
import { sprintBandsForSpan } from "../lib/timeline-days";
import { Button, buttonClasses } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { useDialog } from "~/components/ui/dialog";
import { DocEditor } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { useFeatureFlag } from "~/components/FeatureFlags";
import {
  EpicsTimeline,
  LEVEL_COLOR,
  type TimelineEpic,
  type TimelineTerm,
  type StoryDependencyEdge,
} from "./EpicsTimeline";

// MoSCoW priority for a product requirement (story). Null = unset.
export type StoryPriority = "Must" | "Should" | "Could" | "Wont";

export type EditableStory = {
  id: string;
  title: string;
  notes: string | null;
  status: "Todo" | "InProgress" | "Done";
  // Explicit timeline span. Null falls back to the story's tasks, then to the
  // parent epic — resolved server-side, see the projects.$id loader.
  startsAt: string | null;
  endsAt: string | null;
  // Ids of stories this one waits for, edited in the story form and drawn as
  // arrows between story bars on the timeline.
  dependsOn: string[];
  // Product-requirement columns (see the prod-req table view).
  successMetric: string | null;
  acceptanceCriteria: string | null;
  category: string | null;
  priority: StoryPriority | null;
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
  // Ids of sprints this one depends on (waits for), edited in the sprint form.
  dependsOn: string[];
};

const EPIC_STATUSES = ["Backlog", "Open", "InProgress", "Done", "Cancelled"] as const;
const STORY_PRIORITIES: StoryPriority[] = ["Must", "Should", "Could", "Wont"];

/** A story captured by name and not yet filled in — the design's amber dot.
 *  Derived rather than stored: "has a title and nothing else" is exactly what
 *  quick-add produces, and it stops being true the moment anyone edits it. */
export function isStoryIncomplete(st: {
  notes: string | null;
  startsAt: string | null;
  endsAt: string | null;
}): boolean {
  return !st.notes && !st.startsAt && !st.endsAt;
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
  // The project's planned terms (newest first) — options for an epic's
  // optional target term. Empty hides the picker.
  terms: EpicTermOption[];
  // Per-epic task progress keyed by epic id (Cancelled tasks excluded from
  // both numbers). Epics with no counted tasks may simply be absent.
  taskCounts: Record<string, { done: number; total: number }>;
  canManage: boolean;
  // Hocuspocus WebSocket auth token; userName labels the presence cursor.
  // Both are forwarded into the EpicDetail modal where the description
  // collab DocEditor lives. Null token = signed-out / no-cookie state;
  // the editor's read-only fallback handles it.
  collabToken: string | null;
  userName: string;
  // TimelineEpic shape for the timeline body.
  timelineEpics?: TimelineEpic[];
  // Story dependency edges, drawn as arrows between story bars on the timeline.
  storyDependencies?: StoryDependencyEdge[];
  // Project terms (oldest first) anchoring the timeline's one-week sprint grid.
  timelineTerms?: TimelineTerm[];
  // Opens a task from a timeline task bar. Left to the caller because the task
  // modal lives on the board (?task=), not in this component.
  onTaskClick?: (taskId: string) => void;
  // Opens the task board's create form. Provided only where a board is on the
  // same surface (the os Progress tab), so the Add menu offers "Task" exactly
  // when there is somewhere for it to land.
  onAddTask?: () => void;
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

// One row of the design's add-menu: accent glyph, white label, container fill
// on hover.
function AddMenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-white transition-colors hover:bg-os-container"
    >
      <Plus className="h-4 w-4 flex-shrink-0 text-os-accent" aria-hidden />
      {label}
    </button>
  );
}

export function EpicSprintManager({
  projectId,
  epics,
  terms,
  taskCounts,
  canManage,
  collabToken,
  userName,
  timelineEpics = [],
  storyDependencies = [],
  timelineTerms = [],
  onTaskClick,
  onAddTask,
}: Props) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newEpicOpen, setNewEpicOpen] = useState(false);
  // "All" shows every epic; otherwise only epics matching the selected
  const os = useFeatureFlag("os-redesign");
  // The design's toolbar under the timeline: an Edit toggle that turns the
  // bars into things you can drag, and an Add menu.
  const [editMode, setEditMode] = useState(false);
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

  // Flat "depends on" target list for the story form: every story in the
  // project, labelled with its epic so same-titled stories stay tellable apart.
  const allStoryOptions = useMemo(
    () =>
      epics.flatMap((e) =>
        e.stories.map((st) => ({ id: st.id, name: `${e.title} · ${st.title}` })),
      ),
    [epics],
  );

  function openEpic(epicId: string) {
    setOpenEpicId(epicId);
  }

  function closeEpic() {
    setOpenEpicId(null);
  }

  function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    fn()
      .then(() => revalidator.revalidate())
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong"))
      .finally(() => setBusy(false));
  }

  const errorBanner = error && (
    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
      {error}
    </div>
  );

  // Drag-drop on a bar: shift its span by whole days. Tasks carry their end as
  // dueAt; epics and stories have an explicit endsAt. A bar with no dates isn't
  // laid out at all, so anything reaching here has both.
  const reschedule = (
    kind: "epic" | "story" | "task",
    id: string,
    deltaDays: number,
    edge: "move" | "start" | "end" = "move",
  ) => {
    const shift = (iso: string | null | undefined): string | undefined => {
      if (!iso) return undefined;
      const d = new Date(iso);
      d.setUTCDate(d.getUTCDate() + deltaDays);
      return d.toISOString();
    };
    const bar = timelineEpics.flatMap((e) =>
      kind === "epic"
        ? e.id === id
          ? [{ startsAt: e.startsAt, endsAt: e.endsAt }]
          : []
        : e.stories.flatMap((st) =>
            kind === "story"
              ? st.id === id
                ? [{ startsAt: st.startsAt, endsAt: st.endsAt }]
                : []
              : st.tasks.flatMap((t) =>
                  t.id === id ? [{ startsAt: t.startsAt, endsAt: t.endsAt }] : [],
                ),
          ),
    )[0];
    if (!bar || !bar.startsAt || !bar.endsAt) return;

    // "move" carries both ends; a grip moves one and pins the other. Either
    // way the span has to stay at least a day long — dragging a start past its
    // end would otherwise write an inverted range the timeline can't lay out.
    const startsAt = edge === "end" ? bar.startsAt : shift(bar.startsAt);
    const endsAt = edge === "start" ? bar.endsAt : shift(bar.endsAt);
    if (!startsAt || !endsAt) return;
    if (edge !== "move" && new Date(startsAt) >= new Date(endsAt)) return;

    run(async () => {
      if (kind === "epic") await api(`/api/epics/${id}`, "POST", { startsAt, endsAt });
      else if (kind === "story") await api(`/api/stories/${id}`, "POST", { startsAt, endsAt });
      else await api(`/api/tasks/${id}`, "POST", { startsAt, dueAt: endsAt });
    });
  };

  // The selected epic's detail view is rendered inside a modal over the list.
  // It survives revalidation because we look the epic up fresh each render.
  const activeEpic = openEpicId ? epics.find((e) => e.id === openEpicId) : null;

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
        containerClassName={cn(
          "w-full my-auto",
          os
            ? "max-w-[560px] os-modal-card os-form"
            : "max-w-xl bg-card rounded-2xl shadow-xl p-5 sm:p-6",
        )}
      >
        {/* Eyebrow rather than a heading: the form's own name field is the
            prominent title, exactly as in the detail modal. Under os the
            level moves onto the design's type badge and the heading names the
            dialog, so the epic's own name can be a field with a required mark
            on it. */}
        <div className="flex items-center justify-between gap-2 mb-3">
          {os ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="os-type-badge os-type-badge--epic flex-shrink-0">Epic</span>
              <h2 id="new-epic-title" className="os-modal-title min-w-0 truncate">
                New epic
              </h2>
            </div>
          ) : (
            <h2
              id="new-epic-title"
              className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              New epic
            </h2>
          )}
          <button
            type="button"
            onClick={() => setNewEpicOpen(false)}
            aria-label="Close"
            className={
              os
                ? "os-icon-btn"
                : "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            }
          >
            <X className="w-4 h-4" />
          </button>
        </div>
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
        containerClassName={cn(
          "w-full my-auto",
          os
            ? "max-w-[560px] os-modal-card os-form"
            : "max-w-5xl bg-card rounded-2xl shadow-xl p-5 sm:p-6",
        )}
      >
        {activeEpic && (
          <EpicDetail
            projectId={projectId}
            epic={activeEpic}
            autoNewStory={autoNewStoryEpicId === activeEpic.id}
            storyOptions={allStoryOptions}
            terms={terms}
            timelineTerms={timelineTerms}
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
          />
        )}
      </Modal>

      {/* Clicking an epic or story bar opens the detail/edit modal; a task bar
          defers to the caller, which opens the board's task modal via ?task=. */}
      <EpicsTimeline
        epics={timelineEpics}
        taskCounts={taskCounts}
        terms={timelineTerms}
        storyDependencies={storyDependencies}
        actions={
          canManage && !os ? (
            <Button variant="secondary" size="sm" onClick={() => setNewEpicOpen(true)}>
              + Add epic
            </Button>
          ) : undefined
        }
        editMode={editMode}
        onReschedule={canManage ? reschedule : undefined}
        onEpicClick={canManage ? (id) => openEpic(id) : undefined}
        onStoryClick={canManage ? (epicId) => openEpic(epicId) : undefined}
        onTaskClick={onTaskClick}
      />

      {/* The design's toolbar sits under the timeline, and its Add menu opens
          upward into the space above it. */}
      {os && canManage && (
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            className="os-edit-btn"
            aria-pressed={editMode}
            onClick={() => setEditMode((v) => !v)}
            title={
              editMode
                ? "Done — bars are read-only again"
                : "Drag a bar to move it, or its ends to change one date"
            }
          >
            <Pencil className="h-[15px] w-[15px]" aria-hidden />
            {editMode ? "Done" : "Edit"}
          </button>

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
              Add
            </button>
            {addMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-[calc(100%+8px)] right-0 z-[100] max-h-72 min-w-[200px] overflow-y-auto rounded-xl border border-os-container bg-os-card p-1.5 shadow-[0_-12px_32px_rgba(0,0,0,0.45)]"
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
                          className="flex w-full items-center gap-2.5 truncate rounded-lg px-2.5 py-2 text-left text-sm text-white transition-colors hover:bg-os-container"
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
                    <AddMenuItem
                      label="Epic"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setNewEpicOpen(true);
                      }}
                    />
                    <AddMenuItem label="User story" onClick={() => setAddStoryPicking(true)} />
                    {onAddTask && (
                      <AddMenuItem
                        label="Task"
                        onClick={() => {
                          setAddMenuOpen(false);
                          onAddTask();
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EpicDetail({
  projectId,
  epic,
  autoNewStory = false,
  storyOptions,
  terms,
  timelineTerms,
  canManage,
  busy,
  run,
  api,
  collabToken,
  userName,
  onClose,
  onDeleted,
}: {
  projectId: string;
  epic: EditableEpic;
  // Open with the new-story form already up — Add ▸ User story lands here.
  autoNewStory?: boolean;
  // Every story in the project except the one being edited — "depends on"
  // targets. Cross-epic edges are allowed, same as sprint dependencies.
  storyOptions: { id: string; name: string }[];
  terms: EpicTermOption[];
  // Term spans, oldest first — the anchor for the fixed one-week sprint grid
  // this modal reads the epic's sprints off.
  timelineTerms: TimelineTerm[];
  canManage: boolean;
  busy: boolean;
  run: (fn: () => Promise<void>) => void;
  api: (url: string, method: "POST" | "DELETE", body?: unknown) => Promise<void>;
  collabToken: string | null;
  userName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialog = useDialog();
  const os = useFeatureFlag("os-redesign");
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

  // There is no modal-level edit mode: a manager can add a story, rename the
  // epic, or open the details form straight from the read view.
  const canEditContent = canManage;

  // Which fixed weeks this epic runs through — derived from its dates against
  // the same term-anchored grid the timeline's sprint bands use, so the modal
  // and the timeline can't disagree about which sprint something is in.
  const epicSprints = useMemo(() => {
    if (!epic.startsAt || !epic.endsAt) return [];
    return sprintBandsForSpan(epic.startsAt, epic.endsAt, timelineTerms, (d) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    );
  }, [epic.startsAt, epic.endsAt, timelineTerms]);

  return (
    <div className={cn("max-h-[80vh] overflow-y-auto", os ? "" : "flex flex-col gap-4")}>
      {/* Modal header */}
      <div className={cn("flex items-start justify-between gap-3", os && "mb-6")}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* The design names the level with a badge; the classic header
                marks it with the level's dot. */}
            {os ? (
              <span className="os-type-badge os-type-badge--epic flex-shrink-0">Epic</span>
            ) : (
              <span
                aria-hidden
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: LEVEL_COLOR.epic }}
              />
            )}
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
                  "w-full font-heading text-lg font-bold text-foreground bg-transparent rounded px-1 -mx-1 py-0.5 hover:bg-muted/40 focus:bg-transparent focus:outline-none focus:ring-2 focus:ring-accent-coral/30",
                  // Edited in place, but it is the modal's heading — so it is
                  // set like one. The stored title keeps its own casing.
                  os && "os-record-name",
                )}
              />
            ) : (
              <h2
                id="epic-detail-title"
                className={cn(
                  "font-heading text-lg font-bold text-foreground truncate",
                  os && "os-record-name",
                )}
              >
                {epic.title}
              </h2>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {canManage && (
            <Tooltip label="Delete epic">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    !(await dialog.confirm({
                      title: `Delete epic "${epic.title}"?`,
                      description:
                        "Its sprints and tasks will be unlinked; its user stories will be deleted.",
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

      {/* Epic details. Every field sits in the same row whether you're reading
          it or changing it — there's no edit mode that swaps one layout for
          another, so nothing appears or disappears on entering it. Each
          control saves itself; the API takes partial updates. */}
      {os ? (
        <section>
          <div className="os-field-row">
            <div className="os-field-group">
              <span className="os-field-label">Status</span>
            {canManage ? (
              <Select
                value={epic.status}
                onChange={(value) => void saveEpic({ status: value })}
                options={EPIC_STATUSES.map((st) => ({ value: st, label: st }))}
                buttonClassName={EPIC_FIELD}
              />
            ) : (
              <span className="text-sm text-foreground">{epic.status}</span>
            )}
            </div>
            {terms.length > 0 && (
              <div className="os-field-group">
                <span className="os-field-label">Target term</span>
            {canManage ? (
              <Select
                value={epic.targetTermId ?? ""}
                onChange={(value) => void saveEpic({ targetTermId: value || null })}
                placeholder="No target term"
                options={[
                  { value: "", label: "No target term" },
                  ...terms.map((t) => ({ value: t.id, label: t.code })),
                ]}
                buttonClassName={EPIC_FIELD}
              />
            ) : (
              <span className="text-sm text-foreground">
                {terms.find((t) => t.id === epic.targetTermId)?.code ?? "—"}
              </span>
            )}
              </div>
            )}
          </div>
          <div className="os-field-row">
            <div className="os-field-group">
              <span className="os-field-label">Start date</span>
            {canManage ? (
              <DateField
                mode="date"
                value={epic.startsAt ? dateInputValue(epic.startsAt) : ""}
                onChange={(value) =>
                  void saveEpic({
                    startsAt: value ? new Date(value).toISOString() : null,
                  })
                }
                ariaLabel="Epic start date"
              />
            ) : (
              <span className="text-sm text-foreground">
                {epic.startsAt ? dateInputValue(epic.startsAt) : "—"}
              </span>
            )}
            </div>
            <div className="os-field-group">
              <span className="os-field-label">End date</span>
            {canManage ? (
              <DateField
                mode="date"
                value={epic.endsAt ? dateInputValue(epic.endsAt) : ""}
                onChange={(value) =>
                  void saveEpic({
                    endsAt: value ? new Date(value).toISOString() : null,
                  })
                }
                ariaLabel="Epic end date"
              />
            ) : (
              <span className="text-sm text-foreground">
                {epic.endsAt ? dateInputValue(epic.endsAt) : "—"}
              </span>
            )}
            </div>
          </div>
          {/* Not a picker. A sprint is a fixed week, so the weeks an epic runs
              through are already settled by the two dates above — these state
              them rather than asking again. */}
          <div className="os-field-group">
            <span className="os-field-label">Sprints</span>
            {epicSprints.length > 0 ? (
              <div className="os-sprint-chip-row">
                {epicSprints.map((b) => (
                  <span key={b.key} className="os-sprint-chip os-sprint-chip--active">
                    {b.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-os-grey">
                Set a start and end date to place this epic in its weeks.
              </p>
            )}
          </div>
        </section>
      ) : (
      <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
        <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="min-w-0">
            {canManage ? (
              <Select
                value={epic.status}
                onChange={(value) => void saveEpic({ status: value })}
                options={EPIC_STATUSES.map((st) => ({ value: st, label: st }))}
                buttonClassName={EPIC_FIELD}
              />
            ) : (
              <span className="text-sm text-foreground">{epic.status}</span>
            )}
          </dd>

          {terms.length > 0 && (
            <>
              <dt className="text-muted-foreground">Target term</dt>
              <dd className="min-w-0">
            {canManage ? (
              <Select
                value={epic.targetTermId ?? ""}
                onChange={(value) => void saveEpic({ targetTermId: value || null })}
                placeholder="No target term"
                options={[
                  { value: "", label: "No target term" },
                  ...terms.map((t) => ({ value: t.id, label: t.code })),
                ]}
                buttonClassName={EPIC_FIELD}
              />
            ) : (
              <span className="text-sm text-foreground">
                {terms.find((t) => t.id === epic.targetTermId)?.code ?? "—"}
              </span>
            )}
              </dd>
            </>
          )}

          <dt className="text-muted-foreground">Starts</dt>
          <dd className="min-w-0">
            {canManage ? (
              <DateField
                mode="date"
                value={epic.startsAt ? dateInputValue(epic.startsAt) : ""}
                onChange={(value) =>
                  void saveEpic({
                    startsAt: value ? new Date(value).toISOString() : null,
                  })
                }
                ariaLabel="Epic start date"
              />
            ) : (
              <span className="text-sm text-foreground">
                {epic.startsAt ? dateInputValue(epic.startsAt) : "—"}
              </span>
            )}
          </dd>

          <dt className="text-muted-foreground">Ends</dt>
          <dd className="min-w-0">
            {canManage ? (
              <DateField
                mode="date"
                value={epic.endsAt ? dateInputValue(epic.endsAt) : ""}
                onChange={(value) =>
                  void saveEpic({
                    endsAt: value ? new Date(value).toISOString() : null,
                  })
                }
                ariaLabel="Epic end date"
              />
            ) : (
              <span className="text-sm text-foreground">
                {epic.endsAt ? dateInputValue(epic.endsAt) : "—"}
              </span>
            )}
          </dd>
        </dl>
      </section>
      )}

      {/* Description — always live as a collab editor (the project's
          Overview/PRD pattern). The room name is the epic's descriptionDocId
          (lazily provisioned on first open by a manager). For viewers or
          while provisioning is in flight, falls back to a quiet placeholder
          so the modal isn't empty. */}
      {os && <div className="os-modal-divider" aria-hidden />}
      <section className={cn(!os && "border-t border-border pt-4 first:border-t-0 first:pt-0")}>
        <h3
          className={cn(
            os ? "os-section-header" : "text-sm font-semibold text-foreground mb-2",
          )}
        >
          Description
        </h3>
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

      {/* User stories — card list (not a cramped multi-column table). Notes
          and criteria live in their own blocks so long text doesn't jam into
          the requirement cell. Editing uses the same edit mode as the header
          pencil; each story expands inline rather than a nested table-row form. */}
      {os && <div className="os-modal-divider" aria-hidden />}
      <section className={cn(!os && "border-t border-border pt-4 first:border-t-0 first:pt-0")}>
        <div className="flex items-center justify-between mb-3">
          <h3
            className={cn(
              "flex items-center gap-2",
              os ? "os-section-header !mb-0" : "text-sm font-semibold text-foreground",
            )}
          >
            {/* The design names a section in type, not with a colour dot. */}
            {!os && (
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: LEVEL_COLOR.story }}
              />
            )}
            User stories
          </h3>
          {canEditContent && !newStoryOpen && (
            <button
              type="button"
              onClick={() => setNewStoryOpen(true)}
              className={os ? "os-add-btn os-add-btn--sm" : "text-xs font-medium hover:underline"}
              style={os ? undefined : { color: LEVEL_COLOR.story }}
            >
              {os ? (
                <>
                  <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  New story
                </>
              ) : (
                "+ New story"
              )}
            </button>
          )}
        </div>

        {newStoryOpen &&
          (os ? (
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
          ) : (
            <div className="mb-3 rounded-lg border border-border bg-muted/20 p-3">
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
            </div>
          ))}

        {epic.stories.length === 0 && !newStoryOpen ? (
          <p className="text-sm text-muted-foreground italic">No user stories yet.</p>
        ) : (
          <ul
            ref={storyListRef}
            className={os ? "os-item-list" : "flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x"}
          >
            {epic.stories.map((story) =>
              editStoryId === story.id && !os ? (
                <li
                  key={story.id}
                  className="w-[22rem] flex-shrink-0 snap-start rounded-lg border bg-muted/20 p-3"
                  style={{ borderColor: LEVEL_COLOR.story }}
                >
                  <StoryForm
                    busy={busy}
                    initial={story}
                    storyOptions={storyOptions.filter((o) => o.id !== story.id)}
                    onCancel={() => setEditStoryId(null)}
                    onSubmit={(values) =>
                      run(async () => {
                        await api(`/api/stories/${story.id}`, "POST", values);
                        setEditStoryId(null);
                      })
                    }
                  />
                </li>
              ) : os ? (
                // .quick-add-item: name on the left, one × on the right. The
                // card below is the classic list's row.
                <li key={story.id} className="os-item-row">
                  <button
                    type="button"
                    onClick={() => canEditContent && setEditStoryId(story.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={story.title}
                  >
                    {isStoryIncomplete(story) && (
                      <span
                        className="os-incomplete-dot"
                        title="Added by name — still needs its details"
                      >
                        !
                      </span>
                    )}
                    <span className="truncate">{story.title}</span>
                  </button>
                  {canEditContent && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${story.title}`}
                      className="flex flex-shrink-0 text-os-grey transition-colors hover:text-white"
                      onClick={async () => {
                        if (
                          !(await dialog.confirm({
                            title: `Delete story "${story.title}"?`,
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
                </li>
              ) : (
                <li
                  key={story.id}
                  className="w-[22rem] flex-shrink-0 snap-start rounded-lg border bg-background p-3 sm:p-4"
                  style={{
                    borderColor: `color-mix(in srgb, ${LEVEL_COLOR.story} 45%, transparent)`,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {os && isStoryIncomplete(story) && (
                        <span
                          className="os-incomplete-dot mr-1.5 align-middle"
                          title="Added by name — still needs its details"
                        >
                          !
                        </span>
                      )}
                      <p className="inline text-sm font-medium text-foreground leading-snug">
                        {story.title}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-border bg-muted/30 text-muted-foreground">
                          {story.status}
                        </span>
                        {story.category && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground">
                            {story.category}
                          </span>
                        )}
                        {story.priority && (
                          <span
                            className={`text-[11px] px-1.5 py-0.5 rounded-full border border-border ${STORY_PRIORITY_TONE[story.priority]}`}
                          >
                            {story.priority}
                          </span>
                        )}
                      </div>
                    </div>
                    {canEditContent && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditStoryId(story.id)}
                          className={
                            os
                              ? "os-edit-btn os-add-btn--sm"
                              : "text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-muted"
                          }
                        >
                          <Pencil className="h-3 w-3" aria-hidden />
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !(await dialog.confirm({
                                title: `Delete story "${story.title}"?`,
                                confirmLabel: "Delete",
                                tone: "destructive",
                              }))
                            )
                              return;
                            run(() => api(`/api/stories/${story.id}`, "DELETE"));
                          }}
                          className="text-xs font-medium text-destructive hover:text-destructive/80 px-2 py-1 rounded-md hover:bg-destructive/10 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  {(story.successMetric || story.acceptanceCriteria || story.notes) && (
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
                      {story.successMetric && (
                        <div className="min-w-0 sm:col-span-1">
                          <dt className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
                            Success metric
                          </dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-foreground/90">
                            {story.successMetric}
                          </dd>
                        </div>
                      )}
                      {story.acceptanceCriteria && (
                        <div className="min-w-0 sm:col-span-1">
                          <dt className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
                            Acceptance criteria
                          </dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-foreground/90">
                            {story.acceptanceCriteria}
                          </dd>
                        </div>
                      )}
                      {story.notes && (
                        <div className="min-w-0 sm:col-span-2">
                          <dt className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
                            Notes
                          </dt>
                          <dd className="mt-0.5 whitespace-pre-wrap text-muted-foreground line-clamp-4">
                            {story.notes}
                          </dd>
                        </div>
                      )}
                    </dl>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        {/* Editing a story is the same .modal-card as creating one, so the two
            paths look and behave alike. Hoisted out of the list: rendering it
            per-<li> would have swapped the card out for a form mid-row. */}
        {os &&
          (() => {
            const editing = epic.stories.find((st) => st.id === editStoryId);
            if (!editing) return null;
            return (
              <Modal
                open
                onClose={() => setEditStoryId(null)}
                labelledBy="edit-story-title"
                disableEscape={busy}
                containerClassName="w-full max-w-[560px] my-auto os-modal-card os-form"
              >
                <div className="mb-6 flex items-center justify-between gap-3">
                  <h2 id="edit-story-title" className="os-type-badge os-type-badge--story">
                    User story
                  </h2>
                  <button
                    type="button"
                    onClick={() => setEditStoryId(null)}
                    aria-label="Close"
                    className="os-icon-btn"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <StoryForm
                  busy={busy}
                  initial={editing}
                  storyOptions={storyOptions.filter((o) => o.id !== editing.id)}
                  onCancel={() => setEditStoryId(null)}
                  onSubmit={(values) =>
                    run(async () => {
                      await api(`/api/stories/${editing.id}`, "POST", values);
                      setEditStoryId(null);
                    })
                  }
                />
              </Modal>
            );
          })()}
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
  terms,
  onSubmit,
  onCancel,
}: {
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
}) {
  const os = useFeatureFlag("os-redesign");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<EditableEpic["status"]>("Open");
  const [targetTermId, setTargetTermId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  // The controls themselves are the same either way; only how they're laid out
  // differs, so they're named once here rather than written twice below.
  const statusField = (
    <Select
      value={status}
      onChange={(value) => setStatus(value as EditableEpic["status"])}
      options={EPIC_STATUSES.map((st) => ({ value: st, label: st }))}
      buttonClassName={EPIC_FIELD}
    />
  );
  const termField = (
    <Select
      value={targetTermId}
      onChange={(value) => setTargetTermId(value)}
      placeholder="No target term"
      options={[
        { value: "", label: "No target term" },
        ...terms.map((t) => ({ value: t.id, label: t.code })),
      ]}
      buttonClassName={EPIC_FIELD}
    />
  );
  const startField = (
    <DateField
      mode="date"
      value={startsAt}
      onChange={(value) => setStartsAt(value)}
      ariaLabel="Epic start date"
    />
  );
  const endField = (
    <DateField
      mode="date"
      value={endsAt}
      onChange={(value) => setEndsAt(value)}
      ariaLabel="Epic end date"
    />
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
      className={os ? undefined : "flex flex-col gap-4"}
    >
      {os ? (
        // The design's first field, carrying the mark that says it's the one
        // you can't leave blank.
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
      ) : (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
            style={{ background: LEVEL_COLOR.epic }}
          />
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Epic name"
            aria-label="Epic name"
            className="w-full font-heading text-lg font-bold text-foreground bg-transparent rounded px-1 -mx-1 py-0.5 placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
        </div>
      )}

      {os ? (
        // Fields that answer one question sit on one row: the pairing is what
        // says Starts and Ends are two ends of a single span, and it halves
        // the ladder these four made when each took a row of its own.
        <>
          <div className="os-field-row">
            <div className="os-field-group">
              <span className="os-field-label">Status</span>
              {statusField}
            </div>
            {terms.length > 0 && (
              <div className="os-field-group">
                <span className="os-field-label">Target term</span>
                {termField}
              </div>
            )}
          </div>
          <div className="os-field-row">
            <div className="os-field-group">
              <span className="os-field-label">Starts</span>
              {startField}
              <span className="os-field-hint">
                Optional — left blank, the epic takes its span from its stories.
              </span>
            </div>
            <div className="os-field-group">
              <span className="os-field-label">Ends</span>
              {endField}
            </div>
          </div>
        </>
      ) : (
        <section className="border-t border-border pt-4">
          <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="min-w-0">{statusField}</dd>

            {terms.length > 0 && (
              <>
                <dt className="text-muted-foreground">Target term</dt>
                <dd className="min-w-0">{termField}</dd>
              </>
            )}

            <dt className="text-muted-foreground">Starts</dt>
            <dd className="min-w-0">{startField}</dd>

            <dt className="text-muted-foreground">Ends</dt>
            <dd className="min-w-0">{endField}</dd>
          </dl>
        </section>
      )}

      <div className={os ? "os-modal-footer" : "flex justify-end gap-1.5"}>
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

// Multi-select "waits for" picker for the story form. Checkbox list so several
// can be picked; closes on outside click.
function DependsOnField({
  options,
  value,
  onChange,
  noun,
}: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  // Singular label for the summary line ("2 sprints", "1 story").
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-w-[120px] rounded-md border border-border bg-background px-2 py-1.5 text-left text-sm text-foreground"
      >
        {value.length === 0
          ? "None"
          : `${value.length} ${noun}${value.length === 1 ? "" : "s"}`}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-brand-2">
          {options.map((s) => (
            <Checkbox
              key={s.id}
              checked={value.includes(s.id)}
              onChange={() => toggle(s.id)}
              label={<span className="truncate">{s.name}</span>}
              className="rounded px-2 py-1 text-sm hover:bg-muted"
            />
          ))}
        </div>
      )}
    </div>
  );
}

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;

function StoryForm({
  initial,
  busy,
  storyOptions = [],
  onSubmit,
  onCancel,
}: {
  initial?: EditableStory;
  busy: boolean;
  // Other stories in the project, as "depends on" targets. Empty on create —
  // dependencies are added once the story exists.
  storyOptions?: { id: string; name: string }[];
  onSubmit: (values: {
    title: string;
    notes: string | null;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    dependsOn?: string[];
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
  const os = useFeatureFlag("os-redesign");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [priority, setPriority] = useState<StoryPriority | "">(initial?.priority ?? "");
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? dateInputValue(initial.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(
    initial?.endsAt ? dateInputValue(initial.endsAt) : "",
  );
  const [dependsOn, setDependsOn] = useState<string[]>(initial?.dependsOn ?? []);

  // Named once, laid out twice: the design pairs Status with the due date on
  // one row, the classic form runs them along a wrapping strip of fields.
  const nameField = (
    <input
      type="text"
      autoFocus
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      className={cn(
        os
          ? "w-full"
          : "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30",
      )}
    />
  );
  const statusField = (
    <Select
      value={status}
      onChange={(value) => setStatus(value as EditableStory["status"])}
      options={STORY_STATUSES.map((st) => ({ value: st, label: st }))}
      buttonClassName={
        os
          ? "w-full"
          : "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
      }
    />
  );
  const endField = (
    <DateField
      mode="date"
      value={endsAt}
      onChange={(value) => setEndsAt(value)}
      ariaLabel="Story end (optional)"
    />
  );
  const categoryField = (
    <input
      type="text"
      value={category}
      onChange={(e) => setCategory(e.target.value)}
      placeholder="e.g. Functional"
      className={cn(
        os
          ? "w-full"
          : "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30",
      )}
    />
  );
  const notesField = (
    <textarea
      value={notes}
      onChange={(e) => setNotes(e.target.value)}
      rows={os ? 4 : 2}
      className={cn(
        os
          ? "w-full"
          : "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30",
      )}
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
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          // Only an existing story can point at siblings; the create route
          // ignores the field entirely.
          ...(initial ? { dependsOn } : {}),
          successMetric: clean(successMetric),
          acceptanceCriteria: clean(acceptanceCriteria),
          category: clean(category),
          priority: priority || null,
        });
      }}
      className={cn(os ? "mb-3" : "flex flex-col gap-2 mb-3")}
    >
      {os ? (
        <>
          <label className="os-field-group">
            <span>
              Name<span className="os-required-mark">*</span>
            </span>
            {nameField}
          </label>
          {/* Status and the date the story is wanted by are one decision, so
              they share a row rather than stacking into a ladder. */}
          <div className="os-field-row">
            <label className="os-field-group">
              <span>Status</span>
              {statusField}
            </label>
            <label className="os-field-group">
              <span>Due date</span>
              {endField}
            </label>
          </div>
          <label className="os-field-group">
            <span>Labels</span>
            {categoryField}
          </label>
          <label className="os-field-group">
            <span>Description</span>
            {notesField}
          </label>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]">
              <span className="text-muted-foreground">Story (e.g. “As a user, I can …”)</span>
              {nameField}
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Status</span>
              {statusField}
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Category</span>
              {categoryField}
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Priority</span>
              <Select
                value={priority}
                onChange={(value) => setPriority(value as StoryPriority | "")}
                placeholder="—"
                options={[
                  { value: "", label: "—" },
                  ...STORY_PRIORITIES.map((p) => ({ value: p, label: p })),
                ]}
                buttonClassName="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            </label>
          </div>
          {/* Timeline placement. Left blank, the story inherits its span from
              its tasks, then from the parent epic — so a bar still renders. */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Starts (optional)</span>
              <DateField
                mode="date"
                value={startsAt}
                onChange={(value) => setStartsAt(value)}
                ariaLabel="Story start (optional)"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Ends (optional)</span>
              {endField}
            </label>
            {initial && storyOptions.length > 0 && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Depends on</span>
                <DependsOnField
                  options={storyOptions}
                  value={dependsOn}
                  onChange={setDependsOn}
                  noun="story"
                />
              </label>
            )}
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Success metric (optional)</span>
            <textarea
              value={successMetric}
              onChange={(e) => setSuccessMetric(e.target.value)}
              rows={2}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Acceptance criteria (optional)</span>
            <textarea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              rows={2}
              className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Notes (optional)</span>
            {notesField}
          </label>
        </>
      )}
      <div className={os ? "os-modal-footer" : "flex gap-1.5"}>
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
