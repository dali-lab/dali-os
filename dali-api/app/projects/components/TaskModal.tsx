// Create/edit dialog for a project task. Opened by clicking a card on the
// TaskBoard (edit) or the "+ Add task" button (create). In edit mode the
// parent owns optimistic state, so this just collects the changed fields and
// hands them back via onPatch on close. In create mode there's no task yet, so
// it collects the full set of fields and hands them to onCreate on submit.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import type { TaskBoardOptions, TaskCardModel, Priority, TaskStatus } from "../lib/task-board";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "../lib/task-board";

const PRIORITIES: Priority[] = ["Low", "Normal", "High", "Urgent"];

// Sentinel option in the Status dropdown that archives the task instead of
// setting a status.
const ARCHIVE_OPTION = "__archive__";

type Patch = Partial<TaskCardModel>;

// Field values collected by the modal in create mode. The board turns these
// into a POST (title/dueAt/github) plus follow-up patches (priority/domain/assignees).
export type NewTaskValues = {
  title: string;
  description: string | null;
  priority: Priority;
  dueAt: string | null;
  domainId: string | null;
  assigneeIds: string[];
  // Present = mirror to GitHub on create. `repo` is one of project.repoUrls
  // (normalized to "owner/repo" by the server).
  github: { repo: string } | null;
};

export function TaskModal({
  task,
  options,
  canManage,
  onClose,
  onPatch,
  onCreate,
  onDelete,
  onArchive,
}: {
  // Present in edit mode; omitted (create mode) opens an empty form.
  task?: TaskCardModel;
  options: TaskBoardOptions;
  canManage: boolean;
  onClose: () => void;
  onPatch?: (patch: Patch) => Promise<void> | void;
  onCreate?: (values: NewTaskValues) => Promise<void> | void;
  // Edit mode only. Removes the task (parent handles optimistic removal +
  // closing the modal).
  onDelete?: () => Promise<void> | void;
  // Edit mode only. Archives the task (soft — kept, hidden from the board).
  onArchive?: () => Promise<void> | void;
}) {
  const isCreate = !task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "Normal");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignees.map((a) => a.id) ?? [],
  );
  const [dueDate, setDueDate] = useState<string>(
    task?.dueAt ? dateInputValue(task.dueAt) : "",
  );
  const [domainId, setDomainId] = useState<string>(task?.domain?.id ?? "");
  // Either a TaskStatus or ARCHIVE_OPTION. Edit mode only.
  const [statusValue, setStatusValue] = useState<string>(task?.status ?? "Todo");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Auto-grow the title textarea so long titles wrap into view instead of
  // scrolling horizontally inside a single-line input.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // GitHub mirror toggle (create mode only). Default to the first project repo
  // when there are any; hidden entirely when the project has no repos.
  const githubRepos = options.repoUrls
    .map((u) => normalizeRepoForDisplay(u))
    .filter((r): r is string => !!r);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string>(githubRepos[0] ?? "");

  // Reset local state if the modal stays mounted across task changes (it
  // shouldn't today, but cheap insurance). Create mode has no task to track.
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority);
    setAssigneeIds(task.assignees.map((a) => a.id));
    setDueDate(task.dueAt ? dateInputValue(task.dueAt) : "");
    setDomainId(task.domain?.id ?? "");
    setStatusValue(task.status);
  }, [task?.id]);

  function diffPatch(current: TaskCardModel): Patch {
    const patch: Patch = {};
    if (title.trim() && title.trim() !== current.title) patch.title = title.trim();
    const nextDescription = description.trim() ? description.trim() : null;
    if (nextDescription !== current.description) patch.description = nextDescription;
    if (priority !== current.priority) patch.priority = priority;
    if (statusValue !== ARCHIVE_OPTION && statusValue !== current.status) {
      patch.status = statusValue as TaskStatus;
    }
    const nextDueIso = dueDate ? endOfDayIso(dueDate) : null;
    if (nextDueIso !== current.dueAt) patch.dueAt = nextDueIso;
    const nextDomain =
      domainId === ""
        ? null
        : options.domains.find((d) => d.id === domainId) ?? null;
    const currentDomainId = current.domain?.id ?? null;
    const nextDomainId = nextDomain?.id ?? null;
    if (nextDomainId !== currentDomainId) patch.domain = nextDomain;
    const sortedNext = [...assigneeIds].sort();
    const sortedCurrent = current.assignees.map((a) => a.id).sort();
    const assigneesChanged =
      sortedNext.length !== sortedCurrent.length ||
      sortedNext.some((id, i) => id !== sortedCurrent[i]);
    if (assigneesChanged) {
      patch.assignees = assigneeIds.map((id) => {
        const m = options.members.find((m) => m.id === id);
        return { id, name: m?.name ?? "" };
      });
    }
    return patch;
  }

  async function handleSave() {
    if (!task) return;
    // "Archive" in the Status dropdown is a distinct action, not a status
    // write — hand off to onArchive (which removes the card + closes).
    if (statusValue === ARCHIVE_OPTION) {
      await onArchive?.();
      return;
    }
    if (!onPatch) return;
    const patch = diffPatch(task);
    if (Object.keys(patch).length > 0) {
      await onPatch(patch);
    }
    onClose();
  }

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed || !onCreate) return;
    setSaving(true);
    try {
      await onCreate({
        title: trimmed,
        description: description.trim() ? description.trim() : null,
        priority,
        dueAt: dueDate ? endOfDayIso(dueDate) : null,
        domainId: domainId === "" ? null : domainId,
        assigneeIds,
        github: githubEnabled && githubRepo ? { repo: githubRepo } : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="task-modal-title"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-lg w-full p-5 sm:p-6 my-auto"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <textarea
            id="task-modal-title"
            ref={titleRef}
            rows={1}
            autoFocus={isCreate}
            value={title}
            disabled={!canManage}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // Titles stay single-line logically; Enter just shouldn't
              // insert a newline (this textarea only wraps for visibility).
              if (e.key === "Enter") e.preventDefault();
            }}
            className="flex-1 text-lg font-semibold text-foreground bg-transparent border-0 border-b border-transparent focus:border-border focus:outline-none px-0 py-1 disabled:opacity-100 resize-none overflow-hidden"
            placeholder={isCreate ? "New task title" : "Task title"}
          />
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
            aria-label="Close"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <Field label="Description">
          <textarea
            value={description}
            disabled={!canManage}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What does this task involve? (optional)"
            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground disabled:opacity-70"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!isCreate && (
            <Field label="Status">
              <select
                value={statusValue}
                disabled={!canManage}
                onChange={(e) => setStatusValue(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              >
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </option>
                ))}
                {onArchive && <option value={ARCHIVE_OPTION}>Archive</option>}
              </select>
            </Field>
          )}

          <Field label="Priority">
            <select
              value={priority}
              disabled={!canManage}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Deadline">
            <input
              type="date"
              value={dueDate}
              disabled={!canManage}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            />
          </Field>

          <Field label="Domain">
            <select
              value={domainId}
              disabled={!canManage}
              onChange={(e) => setDomainId(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
            >
              <option value="">—</option>
              {options.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Assignees">
            <AssigneePicker
              all={options.members}
              selected={assigneeIds}
              disabled={!canManage}
              onChange={setAssigneeIds}
            />
          </Field>
        </div>

        {isCreate && canManage && githubRepos.length > 0 && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={githubEnabled}
                onChange={(e) => setGithubEnabled(e.target.checked)}
              />
              Create GitHub issue
            </label>
            {githubEnabled && (
              <select
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              >
                {githubRepos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {!isCreate && task?.githubIssueUrl && (
          <div className="pt-2 border-t border-border text-xs">
            <a
              href={task.githubIssueUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent-coral hover:underline"
            >
              GitHub issue #{task.githubIssueNumber} ↗
            </a>
          </div>
        )}

        {!isCreate && task && (
          <div className="pt-2 border-t border-border text-[11px] text-muted-foreground">
            Created by {task.createdBy.name} on {formatCreatedAt(task.createdAt)}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          {!isCreate && canManage && onDelete && (
            confirmingDelete ? (
              <div className="mr-auto flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Delete this task?</span>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await onDelete();
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="font-medium text-destructive hover:underline disabled:opacity-60"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmingDelete(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="mr-auto text-sm font-medium text-destructive hover:underline"
              >
                Delete
              </button>
            )
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          {canManage &&
            (isCreate ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleCreate()}
                disabled={!title.trim() || saving}
              >
                {saving ? "Creating…" : "Create task"}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSave()}
              >
                Save
              </Button>
            ))}
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground font-medium uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

// Checkbox list of project members. Compact list rather than a multi-select
// because a typical project has 3–8 members and click-to-toggle reads
// faster than cmd-clicking a <select multiple>.
function AssigneePicker({
  all,
  selected,
  disabled,
  onChange,
}: {
  all: { id: string; name: string }[];
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  function toggle(id: string) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }
  if (all.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        No team members on this project yet.
      </p>
    );
  }
  return (
    <div className="max-h-32 overflow-y-auto border border-border rounded-md bg-background p-1.5 flex flex-col gap-0.5">
      {all.map((m) => (
        <label
          key={m.id}
          className={`flex items-center gap-2 px-1.5 py-1 text-sm rounded ${
            disabled ? "" : "hover:bg-muted/40 cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={selected.includes(m.id)}
            disabled={disabled}
            onChange={() => toggle(m.id)}
          />
          <span className="text-foreground">{m.name}</span>
        </label>
      ))}
    </div>
  );
}

// Strip scheme/host and `.git` from a project's repo URL so the dropdown
// shows "owner/repo". Returns null when the value can't be reduced cleanly —
// those entries are dropped from the picker rather than confusing the user.
function normalizeRepoForDisplay(input: string): string | null {
  let s = input.trim();
  s = s.replace(/^https?:\/\/[^/]+\//, "");
  s = s.replace(/^git@[^:]+:/, "");
  s = s.replace(/\.git$/, "");
  s = s.replace(/\/+$/, "");
  return /^[^/\s]+\/[^/\s]+$/.test(s) ? s : null;
}

function dateInputValue(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function endOfDayIso(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59);
  return local.toISOString();
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
