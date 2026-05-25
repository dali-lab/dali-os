// Create/edit dialog for a project task. Opened by clicking a card on the
// TaskBoard (edit) or the "+ Add task" button (create). In edit mode the
// parent owns optimistic state, so this just collects the changed fields and
// hands them back via onPatch on close. In create mode there's no task yet, so
// it collects the full set of fields and hands them to onCreate on submit.

import { useEffect, useState } from "react";
import { Modal } from "~/components/Modal";
import type { TaskBoardOptions, TaskCardModel, Priority } from "../lib/task-board";

const PRIORITIES: Priority[] = ["Low", "Normal", "High", "Urgent"];

type Patch = Partial<TaskCardModel>;

// Field values collected by the modal in create mode. The board turns these
// into a POST (title/dueAt) plus follow-up patches (priority/domain/assignees).
export type NewTaskValues = {
  title: string;
  priority: Priority;
  dueAt: string | null;
  domainId: string | null;
  assigneeIds: string[];
};

export function TaskModal({
  task,
  options,
  canManage,
  onClose,
  onPatch,
  onCreate,
}: {
  // Present in edit mode; omitted (create mode) opens an empty form.
  task?: TaskCardModel;
  options: TaskBoardOptions;
  canManage: boolean;
  onClose: () => void;
  onPatch?: (patch: Patch) => Promise<void> | void;
  onCreate?: (values: NewTaskValues) => Promise<void> | void;
}) {
  const isCreate = !task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "Normal");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignees.map((a) => a.id) ?? [],
  );
  const [dueDate, setDueDate] = useState<string>(
    task?.dueAt ? dateInputValue(task.dueAt) : "",
  );
  const [domainId, setDomainId] = useState<string>(task?.domain?.id ?? "");
  const [saving, setSaving] = useState(false);

  // Reset local state if the modal stays mounted across task changes (it
  // shouldn't today, but cheap insurance). Create mode has no task to track.
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setPriority(task.priority);
    setAssigneeIds(task.assignees.map((a) => a.id));
    setDueDate(task.dueAt ? dateInputValue(task.dueAt) : "");
    setDomainId(task.domain?.id ?? "");
  }, [task?.id]);

  function diffPatch(current: TaskCardModel): Patch {
    const patch: Patch = {};
    if (title.trim() && title.trim() !== current.title) patch.title = title.trim();
    if (priority !== current.priority) patch.priority = priority;
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
    if (!task || !onPatch) return;
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
        priority,
        dueAt: dueDate ? endOfDayIso(dueDate) : null,
        domainId: domainId === "" ? null : domainId,
        assigneeIds,
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
          <input
            id="task-modal-title"
            autoFocus={isCreate}
            value={title}
            disabled={!canManage}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 text-lg font-semibold text-foreground bg-transparent border-0 border-b border-transparent focus:border-border focus:outline-none px-0 py-1 disabled:opacity-100"
            placeholder={isCreate ? "New task title" : "Task title"}
          />
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-sm px-2 py-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          {canManage &&
            (isCreate ? (
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!title.trim() || saving}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Creating…" : "Create task"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSave()}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors"
              >
                Save
              </button>
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
