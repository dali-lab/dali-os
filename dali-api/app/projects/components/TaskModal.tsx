// Create/edit dialog for a project task. Opened by clicking a card on the
// TaskBoard (edit) or the "+ Add task" button (create). In edit mode the
// parent owns optimistic state, so this collects the changed fields and hands
// them back via onPatch on Save — staying open (with the error inline) when
// the save fails. In create mode there's no task yet, so it collects the full
// set of fields and hands them to onCreate on submit.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { uploadFileToS3 } from "~/lib/upload-client";
import {
  normalizeChecklist,
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_MAX_TEXT,
  type ChecklistItem,
} from "../lib/task-checklist";
import type { TaskBoardOptions, TaskCardModel, Priority, TaskStatus } from "../lib/task-board";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "../lib/task-board";

const PRIORITIES: Priority[] = ["Low", "Normal", "High", "Urgent"];

// Borderless control for the Details property panel — the row supplies the
// structure, so the control itself stays quiet.
const PROP_CONTROL =
  "w-full bg-transparent text-sm text-foreground py-1 focus:outline-none disabled:opacity-60";

const COMMENT_MAX = 10_000;

type Patch = Partial<TaskCardModel>;

type CommentModel = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
};

// Field values collected by the modal in create mode. The board turns these
// into a POST (title/dueAt/sprint/epic/github) plus follow-up patches
// (priority/domain/assignees).
export type NewTaskValues = {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueAt: string | null;
  domainId: string | null;
  assigneeIds: string[];
  // Null = backlog / no epic.
  sprintId: string | null;
  epicId: string | null;
  // Not collected in create mode today (the create endpoint doesn't accept a
  // checklist); present so the board's optimistic card mapping can read it.
  checklist?: ChecklistItem[] | null;
  // Present = mirror to GitHub on create. `repo` is one of project.repoUrls
  // (normalized to "owner/repo" by the server).
  github: { repo: string } | null;
};

type ArtifactModel = TaskCardModel["files"][number];

export function TaskModal({
  task,
  projectId,
  options,
  canManage,
  onClose,
  onPatch,
  onCreate,
  onDelete,
  defaultEpicId,
  onArtifactsChanged,
}: {
  // Present in edit mode; omitted (create mode) opens an empty form.
  task?: TaskCardModel;
  projectId: string;
  options: TaskBoardOptions;
  canManage: boolean;
  onClose: () => void;
  // Resolves with the save outcome; on failure the modal stays open and
  // shows `error` inline instead of closing.
  onPatch?: (patch: Patch) => Promise<{ ok: boolean; error?: string }>;
  onCreate?: (values: NewTaskValues) => Promise<void> | void;
  // Edit mode: the parent removes the task (and closes the modal).
  onDelete?: () => void;
  // Create mode: seeds the epic picker (e.g. from the board's epic filter).
  defaultEpicId?: string | null;
  // Edit mode: lets the board revalidate so the card's artifact chip catches
  // up after a link/unlink/upload (artifacts bypass the onPatch path).
  onArtifactsChanged?: () => void;
}) {
  const isCreate = !task;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "Normal");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "Todo");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignees.map((a) => a.id) ?? [],
  );
  const [dueDate, setDueDate] = useState<string>(
    task?.dueAt ? dateInputValue(task.dueAt) : "",
  );
  const [domainId, setDomainId] = useState<string>(task?.domain?.id ?? "");
  const [sprintId, setSprintId] = useState<string>(task?.sprintId ?? "");
  const [epicId, setEpicId] = useState<string>(
    task ? task.epicId ?? "" : defaultEpicId ?? "",
  );

  // Cascading Epic → Sprint: only the chosen epic's sprints are selectable
  // (or, with no epic, the standalone sprints). Changing epic drops a sprint
  // that no longer belongs.
  const epicSprints = options.sprints.filter((s) =>
    epicId ? s.epicId === epicId : s.epicId === null,
  );
  function changeEpic(next: string) {
    setEpicId(next);
    const stillValid = options.sprints.some(
      (s) => s.id === sprintId && (next ? s.epicId === next : s.epicId === null),
    );
    if (!stillValid) setSprintId("");
  }
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.checklist ?? []);
  const [newItemText, setNewItemText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Inline delete confirm (edit mode) — no browser dialog; the parent
  // removes the card optimistically and closes the modal.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Auto-grow the title textarea so long titles wrap into view instead of
  // scrolling horizontally inside a single-line input.
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  // GitHub repos (normalized "owner/repo") power the create-mode mirror
  // toggle and the edit-mode "Link GitHub issue" picker. Hidden when the
  // project has no repos.
  const githubRepos = options.repoUrls
    .map((u) => normalizeRepoForDisplay(u))
    .filter((r): r is string => !!r);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [githubRepo, setGithubRepo] = useState<string>(githubRepos[0] ?? "");

  // Edit-mode GitHub mirror state. Local so link/unlink reflect immediately —
  // the parent's task model catches up on its next revalidation.
  const [github, setGithub] = useState<{ issueNumber: number | null; url: string | null }>({
    issueNumber: task?.githubIssueNumber ?? null,
    url: task?.githubIssueUrl ?? null,
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkRepo, setLinkRepo] = useState<string>(githubRepos[0] ?? "");
  const [linkIssueNumber, setLinkIssueNumber] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Artifacts (edit mode): linked project files. Local so link/unlink/upload
  // reflect immediately — the parent's task model catches up on revalidation.
  const [artifacts, setArtifacts] = useState<ArtifactModel[]>(task?.files ?? []);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachFileId, setAttachFileId] = useState("");
  const artifactInputRef = useRef<HTMLInputElement | null>(null);

  // Comments (edit mode). null = still loading.
  const [comments, setComments] = useState<CommentModel[] | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentPosting, setCommentPosting] = useState(false);
  const [commentPostError, setCommentPostError] = useState<string | null>(null);

  // Reset local state if the modal stays mounted across task changes (it
  // shouldn't today, but cheap insurance). Create mode has no task to track.
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority);
    setStatus(task.status);
    setAssigneeIds(task.assignees.map((a) => a.id));
    setDueDate(task.dueAt ? dateInputValue(task.dueAt) : "");
    setDomainId(task.domain?.id ?? "");
    setSprintId(task.sprintId ?? "");
    setEpicId(task.epicId ?? "");
    setChecklist(task.checklist ?? []);
    setGithub({ issueNumber: task.githubIssueNumber, url: task.githubIssueUrl });
    setArtifacts(task.files);
    setSaveError(null);
  }, [task?.id]);

  // Fetch comments when an existing task opens.
  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    setComments(null);
    setCommentsError(null);
    (async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/comments`, {
          credentials: "include",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `Request failed: ${res.status}`);
        }
        const j = (await res.json()) as { comments: CommentModel[] };
        if (!cancelled) setComments(j.comments);
      } catch (err) {
        if (!cancelled) {
          setComments([]);
          setCommentsError(
            err instanceof Error ? err.message : "Couldn't load comments.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task?.id]);

  function diffPatch(current: TaskCardModel): Patch {
    const patch: Patch = {};
    if (title.trim() && title.trim() !== current.title) patch.title = title.trim();
    const nextDescription = description.trim() ? description.trim() : null;
    if (nextDescription !== current.description) patch.description = nextDescription;
    if (priority !== current.priority) patch.priority = priority;
    if (status !== current.status) patch.status = status;
    const nextDueIso = dueDate ? endOfDayIso(dueDate) : null;
    if (nextDueIso !== current.dueAt) patch.dueAt = nextDueIso;
    const nextDomain =
      domainId === ""
        ? null
        : options.domains.find((d) => d.id === domainId) ?? null;
    const currentDomainId = current.domain?.id ?? null;
    const nextDomainId = nextDomain?.id ?? null;
    if (nextDomainId !== currentDomainId) patch.domain = nextDomain;
    const nextSprintId = sprintId === "" ? null : sprintId;
    if (nextSprintId !== current.sprintId) patch.sprintId = nextSprintId;
    const nextEpicId = epicId === "" ? null : epicId;
    if (nextEpicId !== current.epicId) patch.epicId = nextEpicId;
    const nextChecklist = normalizeChecklist(checklist);
    if (JSON.stringify(nextChecklist) !== JSON.stringify(current.checklist ?? [])) {
      patch.checklist = nextChecklist.length > 0 ? nextChecklist : null;
    }
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

  function isDirty(): boolean {
    if (task) {
      return Object.keys(diffPatch(task)).length > 0 || commentDraft.trim() !== "";
    }
    // Create mode: anything beyond the seeded defaults counts.
    return (
      title.trim() !== "" ||
      description.trim() !== "" ||
      priority !== "Normal" ||
      status !== "Todo" ||
      dueDate !== "" ||
      domainId !== "" ||
      assigneeIds.length > 0 ||
      sprintId !== "" ||
      epicId !== (defaultEpicId ?? "") ||
      githubEnabled
    );
  }

  // Close guard for X / backdrop / Escape / Cancel: unsaved edits need an
  // explicit confirm before they're thrown away.
  function guardedClose() {
    if (isDirty() && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  async function handleSave() {
    if (!task || !onPatch) return;
    const patch = diffPatch(task);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await onPatch(patch);
      if (res.ok) {
        onClose();
        return;
      }
      setSaveError(res.error ?? "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed || !onCreate) return;
    setSaving(true);
    try {
      await onCreate({
        title: trimmed,
        description: description.trim() ? description.trim() : null,
        status,
        priority,
        dueAt: dueDate ? endOfDayIso(dueDate) : null,
        domainId: domainId === "" ? null : domainId,
        assigneeIds,
        sprintId: sprintId === "" ? null : sprintId,
        epicId: epicId === "" ? null : epicId,
        github: githubEnabled && githubRepo ? { repo: githubRepo } : null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // Toggling a checkbox saves immediately (highest-frequency action); text
  // add/remove ride along with Save like the other fields.
  async function toggleChecklistItem(index: number) {
    const prev = checklist;
    const next = prev.map((it, i) => (i === index ? { ...it, done: !it.done } : it));
    setChecklist(next);
    if (!task || !onPatch) return;
    const normalized = normalizeChecklist(next);
    const res = await onPatch({
      checklist: normalized.length > 0 ? normalized : null,
    });
    if (!res.ok) {
      setChecklist(prev);
      setSaveError(res.error ?? "Couldn't update the checklist.");
    }
  }

  function addChecklistItem() {
    const text = newItemText.trim();
    if (!text || checklist.length >= CHECKLIST_MAX_ITEMS) return;
    setChecklist([...checklist, { text, done: false }]);
    setNewItemText("");
  }

  function removeChecklistItem(index: number) {
    setChecklist(checklist.filter((_, i) => i !== index));
  }

  async function postComment() {
    if (!task) return;
    const text = commentDraft.trim();
    if (!text || commentPosting) return;
    const temp: CommentModel = {
      id: `temp-${Date.now()}`,
      body: text,
      createdAt: new Date().toISOString(),
      author: { id: "", name: "You" },
    };
    setCommentPosting(true);
    setCommentPostError(null);
    setComments((cur) => [...(cur ?? []), temp]);
    setCommentDraft("");
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      const saved = (await res.json()) as CommentModel;
      setComments((cur) => (cur ?? []).map((c) => (c.id === temp.id ? saved : c)));
    } catch (err) {
      // Roll the optimistic row back and restore the draft so nothing is lost.
      setComments((cur) => (cur ?? []).filter((c) => c.id !== temp.id));
      setCommentDraft(text);
      setCommentPostError(
        err instanceof Error ? err.message : "Couldn't post comment.",
      );
    } finally {
      setCommentPosting(false);
    }
  }

  async function linkArtifact(fileId: string): Promise<void> {
    if (!task) return;
    const res = await fetch(`/api/tasks/${task.id}/files`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    const j = (await res.json().catch(() => ({}))) as Partial<ArtifactModel> & {
      error?: string;
    };
    if (!res.ok) throw new Error(j.error ?? `Request failed: ${res.status}`);
    setArtifacts((cur) =>
      cur.some((a) => a.id === j.id)
        ? cur
        : [...cur, { id: j.id!, title: j.title!, versionCount: j.versionCount ?? 1 }],
    );
    onArtifactsChanged?.();
  }

  async function handleAttachArtifact() {
    if (!attachFileId) return;
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      await linkArtifact(attachFileId);
      setAttachOpen(false);
      setAttachFileId("");
    } catch (err) {
      setArtifactError(err instanceof Error ? err.message : "Couldn't attach the file.");
    } finally {
      setArtifactBusy(false);
    }
  }

  async function handleUnlinkArtifact(fileId: string) {
    if (!task) return;
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/files`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      setArtifacts((cur) => cur.filter((a) => a.id !== fileId));
      onArtifactsChanged?.();
    } catch (err) {
      setArtifactError(err instanceof Error ? err.message : "Couldn't unlink the file.");
    } finally {
      setArtifactBusy(false);
    }
  }

  // Upload a brand-new artifact: S3 direct upload → register as a project
  // file → link it to this task. The file also appears in the project's
  // Files section (it's a normal ProjectFile).
  async function handleUploadArtifact(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked || !task) return;
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      const meta = await uploadFileToS3(picked, `project-files/${projectId}`);
      const res = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: picked.name, ...meta }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !j.id) throw new Error(j.error ?? "Failed to save the upload");
      await linkArtifact(j.id);
    } catch (err) {
      setArtifactError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setArtifactBusy(false);
    }
  }

  async function handleLinkGithub() {
    if (!task) return;
    const num = Number(linkIssueNumber);
    if (!linkRepo || !Number.isInteger(num) || num <= 0) {
      setLinkError("Enter a valid issue number.");
      return;
    }
    setLinkBusy(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/github`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: linkRepo, issueNumber: num }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        githubIssueNumber?: number;
        githubIssueUrl?: string;
      };
      if (!res.ok) throw new Error(j.error ?? `Request failed: ${res.status}`);
      setGithub({ issueNumber: j.githubIssueNumber ?? num, url: j.githubIssueUrl ?? null });
      setLinkOpen(false);
      setLinkIssueNumber("");
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Couldn't link the issue.");
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleUnlinkGithub() {
    if (!task) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/github`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed: ${res.status}`);
      }
      setGithub({ issueNumber: null, url: null });
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Couldn't unlink the issue.");
    } finally {
      setLinkBusy(false);
    }
  }

  const checklistDone = checklist.filter((i) => i.done).length;

  return (
    <Modal
      open
      onClose={guardedClose}
      labelledBy="task-modal-title"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-2xl w-full p-5 sm:p-6 my-auto"
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
            onClick={guardedClose}
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

        {/* Details — one tidy property panel (label · control rows) instead of
            a grid of boxed inputs, so the metadata reads as scannable
            properties rather than a wall of fields. */}
        <div className="rounded-lg border border-border divide-y divide-border">
          <PropRow label="Status">
            <select
              value={status}
              disabled={!canManage}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className={PROP_CONTROL}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </PropRow>

          <PropRow label="Priority">
            <select
              value={priority}
              disabled={!canManage}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className={PROP_CONTROL}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </PropRow>

          <PropRow label="Epic">
            <select
              value={epicId}
              disabled={!canManage}
              onChange={(e) => changeEpic(e.target.value)}
              className={PROP_CONTROL}
            >
              <option value="">No epic</option>
              {options.epics.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </PropRow>

          <PropRow label="Sprint">
            <select
              value={sprintId}
              disabled={!canManage || epicSprints.length === 0}
              onChange={(e) => setSprintId(e.target.value)}
              className={PROP_CONTROL}
            >
              <option value="">
                {epicSprints.length === 0
                  ? epicId
                    ? "No sprints in this epic"
                    : "Pick an epic first"
                  : "None"}
              </option>
              {epicSprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status === "Closed" ? " (closed)" : ""}
                </option>
              ))}
            </select>
          </PropRow>

          <PropRow label="Domain">
            <select
              value={domainId}
              disabled={!canManage}
              onChange={(e) => setDomainId(e.target.value)}
              className={PROP_CONTROL}
            >
              <option value="">—</option>
              {options.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </PropRow>

          <PropRow label="Deadline">
            <input
              type="date"
              value={dueDate}
              disabled={!canManage}
              onChange={(e) => setDueDate(e.target.value)}
              className={PROP_CONTROL}
            />
          </PropRow>

          <PropRow label="Assignees" align="start">
            <AssigneePicker
              all={options.members}
              selected={assigneeIds}
              disabled={!canManage}
              onChange={setAssigneeIds}
            />
          </PropRow>
        </div>

        {!isCreate && (
          <div className="flex flex-col gap-1.5 text-xs">
            <span className="text-muted-foreground font-medium uppercase tracking-wide">
              Checklist
              {checklist.length > 0 && ` (${checklistDone}/${checklist.length})`}
            </span>
            {checklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={!canManage}
                  onChange={() => void toggleChecklistItem(i)}
                  aria-label={item.text}
                />
                <span
                  className={`flex-1 text-sm ${
                    item.done ? "line-through text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {item.text}
                </span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => removeChecklistItem(i)}
                    aria-label={`Remove "${item.text}"`}
                    className="text-muted-foreground/70 hover:text-foreground rounded p-0.5 hover:bg-muted"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden />
                  </button>
                )}
              </div>
            ))}
            {canManage && checklist.length < CHECKLIST_MAX_ITEMS && (
              <input
                type="text"
                value={newItemText}
                maxLength={CHECKLIST_MAX_TEXT}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addChecklistItem();
                  }
                }}
                placeholder="Add checklist item and press Enter"
                className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              />
            )}
          </div>
        )}

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

        {!isCreate && task && (github.url || (canManage && githubRepos.length > 0)) && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border text-xs">
            {github.url ? (
              <div className="flex items-center justify-between gap-2">
                <a
                  href={github.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent-coral hover:underline"
                >
                  GitHub issue #{github.issueNumber} ↗
                </a>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => void handleUnlinkGithub()}
                    disabled={linkBusy}
                    className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
                  >
                    {linkBusy ? "Unlinking…" : "Unlink"}
                  </button>
                )}
              </div>
            ) : linkOpen ? (
              <div className="flex flex-col gap-2">
                <select
                  value={linkRepo}
                  onChange={(e) => setLinkRepo(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                >
                  {githubRepos.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={linkIssueNumber}
                    onChange={(e) => setLinkIssueNumber(e.target.value)}
                    placeholder="Issue #"
                    className="w-24 px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleLinkGithub()}
                    disabled={linkBusy || !linkIssueNumber}
                  >
                    {linkBusy ? "Linking…" : "Link"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setLinkOpen(false);
                      setLinkError(null);
                    }}
                    className="text-muted-foreground hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="self-start text-accent-coral hover:underline"
              >
                Link GitHub issue
              </button>
            )}
            {linkError && <p className="text-accent-coral">{linkError}</p>}
          </div>
        )}

        {!isCreate && task && (canManage || artifacts.length > 0) && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border text-xs">
            <span className="text-muted-foreground font-medium uppercase tracking-wide">
              Work files
              {artifacts.length > 0 && ` (${artifacts.length})`}
            </span>
            {artifacts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2">
                <Link
                  to={`/documents/file/${a.id}`}
                  className="min-w-0 truncate text-sm text-accent-coral hover:underline"
                >
                  {a.title}
                </Link>
                <span className="flex-shrink-0 text-muted-foreground">
                  {a.versionCount} {a.versionCount === 1 ? "version" : "versions"}
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => void handleUnlinkArtifact(a.id)}
                      disabled={artifactBusy}
                      className="ml-2 text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60"
                    >
                      Unlink
                    </button>
                  )}
                </span>
              </div>
            ))}
            {canManage && (
              <div className="flex items-center gap-3">
                <input
                  ref={artifactInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => void handleUploadArtifact(e)}
                />
                <button
                  type="button"
                  onClick={() => artifactInputRef.current?.click()}
                  disabled={artifactBusy}
                  className="text-accent-coral hover:underline disabled:opacity-60"
                >
                  {artifactBusy ? "Working…" : "Upload file"}
                </button>
                {options.projectFiles.some(
                  (f) => !artifacts.some((a) => a.id === f.id),
                ) &&
                  (attachOpen ? (
                    <span className="flex items-center gap-2">
                      <select
                        value={attachFileId}
                        onChange={(e) => setAttachFileId(e.target.value)}
                        className="px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground"
                      >
                        <option value="">Choose a file…</option>
                        {options.projectFiles
                          .filter((f) => !artifacts.some((a) => a.id === f.id))
                          .map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.title}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAttachArtifact()}
                        disabled={artifactBusy || !attachFileId}
                        className="text-accent-coral hover:underline disabled:opacity-60"
                      >
                        Attach
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAttachOpen(false);
                          setAttachFileId("");
                        }}
                        className="text-muted-foreground hover:underline"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAttachOpen(true)}
                      disabled={artifactBusy}
                      className="text-accent-coral hover:underline disabled:opacity-60"
                    >
                      Attach existing
                    </button>
                  ))}
              </div>
            )}
            {artifactError && <p className="text-accent-coral">{artifactError}</p>}
          </div>
        )}

        {!isCreate && task && (
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Comments
              {comments !== null && ` (${comments.length})`}
            </span>
            {comments === null ? (
              <p className="text-xs text-muted-foreground italic">Loading comments…</p>
            ) : (
              <>
                {commentsError && (
                  <p className="text-xs text-accent-coral">{commentsError}</p>
                )}
                {comments.length === 0 && !commentsError && (
                  <p className="text-xs text-muted-foreground italic">No comments yet.</p>
                )}
                {comments.length > 0 && (
                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
                    {comments.map((c) => (
                      <div key={c.id} className="text-sm">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-foreground">
                            {c.author.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatCommentAt(c.createdAt)}
                          </span>
                        </div>
                        <p className="text-foreground whitespace-pre-wrap">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {canManage && (
              <>
                <textarea
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  rows={2}
                  maxLength={COMMENT_MAX}
                  placeholder="Write a comment…"
                  className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
                />
                {commentPostError && (
                  <p className="text-xs text-accent-coral">{commentPostError}</p>
                )}
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void postComment()}
                    disabled={!commentDraft.trim() || commentPosting}
                  >
                    {commentPosting ? "Posting…" : "Comment"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {saveError && <p className="text-xs text-accent-coral">{saveError}</p>}

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          {!isCreate && canManage && onDelete &&
            (confirmingDelete ? (
              <div className="mr-auto flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  Delete this task?
                  {task?.githubIssueNumber != null && " Its GitHub issue stays open."}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete()}
                  className="font-medium text-destructive hover:underline"
                >
                  Delete
                </button>
                <button
                  type="button"
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
            ))}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={guardedClose}
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
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              ))}
          </div>
        </div>

        {!isCreate && task && (
          <div className="text-[11px] text-muted-foreground text-right">
            Created by {task.createdBy.name} on {formatCreatedAt(task.createdAt)}
          </div>
        )}
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

// One row in the Details property panel: a fixed-width label and its control.
function PropRow({
  label,
  children,
  align = "center",
}: {
  label: string;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={`flex gap-3 px-3 py-2 ${
        align === "start" ? "items-start" : "items-center"
      }`}
    >
      <span
        className={`w-24 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground ${
          align === "start" ? "pt-1.5" : ""
        }`}
      >
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
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

// "Mar 12, 3:41 PM" (year added when it isn't this year).
function formatCommentAt(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
