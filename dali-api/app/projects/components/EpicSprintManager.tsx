import { useState } from "react";
import { useRevalidator } from "react-router";
import { Modal } from "~/components/Modal";
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
  status: "Open" | "InProgress" | "Done" | "Cancelled";
  // ISO strings or null when unset. Explicit epic span; the timeline prefers
  // these over sprint-derived dates.
  startsAt: string | null;
  endsAt: string | null;
  // Collab-doc reference for the epic's rich description (Notion-style),
  // same pattern as the project Overview/PRD pages. Null when none attached.
  descriptionDocId: string | null;
  // User stories under this epic, ordered by position.
  stories: EditableStory[];
};

export type EditableSprint = {
  id: string;
  name: string;
  // ISO strings; rendered into <input type="date"> as YYYY-MM-DD.
  startsAt: string;
  endsAt: string;
  status: "Planned" | "Active" | "Closed";
  epicId: string | null;
};

const EPIC_STATUSES = ["Open", "InProgress", "Done", "Cancelled"] as const;
const SPRINT_STATUSES = ["Planned", "Active", "Closed"] as const;

type Props = {
  projectId: string;
  timelineEpics: TimelineEpic[];
  epics: EditableEpic[];
  sprints: EditableSprint[];
  canManage: boolean;
};

function dateInputValue(iso: string): string {
  // <input type="date"> wants YYYY-MM-DD.
  return new Date(iso).toISOString().slice(0, 10);
}

async function api(url: string, method: "POST" | "DELETE", body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(b.error ?? `Request failed: ${res.status}`);
  }
}

export function EpicSprintManager({
  projectId,
  timelineEpics,
  epics,
  sprints,
  canManage,
}: Props) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newEpicOpen, setNewEpicOpen] = useState(false);
  // The selected epic opens its detail view in a modal over the list.
  const [openEpicId, setOpenEpicId] = useState<string | null>(null);
  // When opened via the row's "Edit" affordance the detail panel jumps
  // straight into the epic edit form rather than the read view.
  const [openInEdit, setOpenInEdit] = useState(false);

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

  // The selected epic's detail view is rendered inside a modal over the list.
  // It survives revalidation because we look the epic up fresh each render.
  const openEpic = openEpicId ? epics.find((e) => e.id === openEpicId) : null;

  return (
    <div className="flex flex-col gap-4">
      {errorBanner}

      <Modal
        open={openEpic != null}
        onClose={() => {
          setOpenEpicId(null);
          setOpenInEdit(false);
        }}
        labelledBy="epic-detail-title"
        disableEscape={busy}
        containerClassName="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-5 sm:p-6 my-auto"
      >
        {openEpic && (
          <EpicDetail
            projectId={projectId}
            epic={openEpic}
            sprints={sprints.filter((s) => s.epicId === openEpic.id)}
            canManage={canManage}
            busy={busy}
            startInEdit={openInEdit}
            run={run}
            api={api}
            onClose={() => {
              setOpenEpicId(null);
              setOpenInEdit(false);
            }}
            onDeleted={() => {
              setOpenEpicId(null);
              setOpenInEdit(false);
            }}
          />
        )}
      </Modal>

      {/* Epics */}
      <section className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Epics</h3>
          {canManage && !newEpicOpen && (
            <button
              type="button"
              onClick={() => setNewEpicOpen(true)}
              className="text-xs font-medium text-accent-coral hover:underline"
            >
              + New epic
            </button>
          )}
        </div>

        {newEpicOpen && (
          <EpicForm
            busy={busy}
            onCancel={() => setNewEpicOpen(false)}
            onSubmit={(values) =>
              run(async () => {
                await api(`/api/projects/${projectId}/epics`, "POST", values);
                setNewEpicOpen(false);
              })
            }
          />
        )}

        {epics.length === 0 && !newEpicOpen ? (
          <p className="text-sm text-muted-foreground italic">No epics yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {epics.map((epic) => {
              const sprintCount = sprints.filter((s) => s.epicId === epic.id).length;
              return (
                <div
                  key={epic.id}
                  className="py-2 flex items-center justify-between gap-3 text-sm hover:bg-muted/50 -mx-2 px-2 rounded transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenInEdit(false);
                      setOpenEpicId(epic.id);
                    }}
                    className="min-w-0 text-left flex-1"
                  >
                    <span className="text-foreground">{epic.title}</span>
                    {epic.startsAt && epic.endsAt && (
                      <span className="text-[11px] text-muted-foreground ml-2">
                        {dateInputValue(epic.startsAt)} → {dateInputValue(epic.endsAt)}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground ml-2">
                      · {sprintCount} {sprintCount === 1 ? "sprint" : "sprints"} ·{" "}
                      {epic.stories.length}{" "}
                      {epic.stories.length === 1 ? "story" : "stories"}
                    </span>
                  </button>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-muted-foreground">{epic.status}</span>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenInEdit(true);
                          setOpenEpicId(epic.id);
                        }}
                        className="text-xs font-medium text-accent-coral hover:underline"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setOpenInEdit(false);
                        setOpenEpicId(epic.id);
                      }}
                      aria-label={`Open ${epic.title}`}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      ›
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Timeline (read-only visualization) */}
      <section>
        <h3 className="text-sm font-semibold text-foreground mb-2">Timeline</h3>
        <EpicsTimeline epics={timelineEpics} />
      </section>

      {/* Sprints — read-only overview. Sprints are created and edited from
          inside an epic's detail panel; there is no standalone add here. */}
      <section className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Sprints</h3>
        {sprints.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No sprints yet. Open an epic to add one.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {sprints.map((sprint) => {
              const epic = sprint.epicId
                ? epics.find((e) => e.id === sprint.epicId)
                : null;
              return (
                <div
                  key={sprint.id}
                  className="py-2 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <span className="text-foreground">{sprint.name}</span>
                    <span className="text-[11px] text-muted-foreground ml-2">
                      {dateInputValue(sprint.startsAt)} → {dateInputValue(sprint.endsAt)}
                      {" · "}
                      {epic ? epic.title : "—"}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground flex-shrink-0">
                    {sprint.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function EpicDetail({
  projectId,
  epic,
  sprints,
  canManage,
  busy,
  startInEdit,
  run,
  api,
  onClose,
  onDeleted,
}: {
  projectId: string;
  epic: EditableEpic;
  sprints: EditableSprint[];
  canManage: boolean;
  busy: boolean;
  // When true the detail panel opens with the epic edit form already
  // expanded (entered via the row's "Edit" affordance).
  startInEdit: boolean;
  run: (fn: () => Promise<void>) => void;
  api: (url: string, method: "POST" | "DELETE", body?: unknown) => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [editEpicOpen, setEditEpicOpen] = useState(canManage && startInEdit);
  const [newSprintOpen, setNewSprintOpen] = useState(false);
  const [editSprintId, setEditSprintId] = useState<string | null>(null);
  const [newStoryOpen, setNewStoryOpen] = useState(false);
  const [editStoryId, setEditStoryId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
      {/* Modal header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="epic-detail-title"
            className="font-heading text-lg font-bold text-foreground truncate"
          >
            {epic.title}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {epic.status}
            {epic.startsAt && epic.endsAt && (
              <>
                {" · "}
                {dateInputValue(epic.startsAt)} → {dateInputValue(epic.endsAt)}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {canManage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete epic "${epic.title}"? Its sprints, stories and tasks will be unlinked, not deleted.`,
                  )
                )
                  return;
                run(async () => {
                  await api(`/api/epics/${epic.id}`, "DELETE");
                  onDeleted();
                });
              }}
              className="text-xs text-destructive hover:underline disabled:opacity-60"
            >
              Delete epic
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            ×
          </button>
        </div>
      </div>

      {/* Epic details */}
      <section className="bg-card border border-border rounded-lg p-4">
        {editEpicOpen ? (
          <EpicForm
            busy={busy}
            initial={epic}
            onCancel={() => setEditEpicOpen(false)}
            onSubmit={(values) =>
              run(async () => {
                await api(`/api/epics/${epic.id}`, "POST", values);
                setEditEpicOpen(false);
              })
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs text-muted-foreground">Description</span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setEditEpicOpen(true)}
                  className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                >
                  Edit
                </button>
              )}
            </div>
            {epic.description ? (
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {epic.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No description yet.
              </p>
            )}
          </div>
        )}
      </section>

      {/* User stories */}
      <section className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">User stories</h3>
          {canManage && !newStoryOpen && (
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
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditStoryId(story.id)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Delete story "${story.title}"?`)) return;
                            run(() => api(`/api/stories/${story.id}`, "DELETE"));
                          }}
                          className="text-xs text-destructive hover:underline disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* Sprints — created only here, scoped to this epic */}
      <section className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">Sprints</h3>
          {canManage && !newSprintOpen && (
            <button
              type="button"
              onClick={() => setNewSprintOpen(true)}
              className="text-xs font-medium text-accent-coral hover:underline"
            >
              + New sprint
            </button>
          )}
        </div>

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
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-muted-foreground">{sprint.status}</span>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditSprintId(sprint.id)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (!window.confirm(`Delete sprint "${sprint.name}"? Its tasks move back to the backlog.`)) return;
                            run(() => api(`/api/sprints/${sprint.id}`, "DELETE"));
                          }}
                          className="text-xs text-destructive hover:underline disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function EpicForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: EditableEpic;
  busy: boolean;
  onSubmit: (values: {
    title: string;
    description: string | null;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus] = useState(initial?.status ?? "Open");
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
          // Empty → null clears the description.
          description: description.trim() ? description.trim() : null,
          status,
          // Dates are optional for epics; empty → null clears the field.
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        });
      }}
      className="flex flex-col gap-2 mb-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs flex-1 min-w-[200px]">
          <span className="text-muted-foreground">Title</span>
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

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="What is this epic about?"
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
      </label>

      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
        >
          Save
        </button>
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

// Sprints are always created/edited from within an epic's detail panel, so
// there is no epic picker — the epic is implied by context.
function SprintForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: EditableSprint;
  busy: boolean;
  onSubmit: (values: {
    name: string;
    startsAt: string;
    endsAt: string;
    status: string;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startsAt, setStartsAt] = useState(
    initial ? dateInputValue(initial.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(initial ? dateInputValue(initial.endsAt) : "");
  const [status, setStatus] = useState(initial?.status ?? "Planned");

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
        });
      }}
      className="flex flex-wrap items-end gap-2 mb-3"
    >
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
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
        >
          Save
        </button>
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
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 transition-colors"
        >
          Save
        </button>
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
