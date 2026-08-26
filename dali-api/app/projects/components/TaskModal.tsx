// Create/edit dialog for a project task. Opened by clicking a card on the
// TaskBoard (edit) or the epic panel's Add ▸ Task item (create). In edit mode the
// parent owns optimistic state, so this collects the changed fields and hands
// them back via onPatch on Save — staying open (with the error inline) when
// the save fails. In create mode there's no task yet, so it collects the full
// set of fields and hands them to onCreate on submit.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { X, Pencil } from "lucide-react";
import { Modal } from "~/components/Modal";
import { Button, buttonClasses } from "~/components/ui/Button";
import { Avatar } from "~/components/ui/Avatar";
import { MentionTextInput } from "~/components/MentionTextInput";
import { Markdown } from "~/components/Markdown";
import { useDialog } from "~/components/ui/dialog";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { uploadFileToS3 } from "~/lib/upload-client";
import { Select, Tooltip } from "~/components/ui/floating";
import {
  normalizeChecklist,
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_MAX_TEXT,
  type ChecklistItem,
} from "../lib/task-checklist";
import type { TaskBoardOptions, TaskCardModel, TaskStatus } from "../lib/task-board";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "../lib/task-board";
import { useFeatureFlag } from "~/components/FeatureFlags";
import { cn } from "~/lib/cn";

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
  author: { id: string; name: string; photoUrl: string | null };
};

// Field values collected by the modal in create mode. The board turns these
// into a POST (title/dueAt/sprint/epic/github) plus follow-up patches
// (domain/assignees).
export type NewTaskValues = {
  title: string;
  description: string | null;
  status: TaskStatus;
  dueAt: string | null;
  // Timeline start, as a UTC-midnight day. Null = inherit from the story.
  startsAt: string | null;
  domainId: string | null;
  assigneeIds: string[];
  // Null = backlog / no epic / no parent story.
  sprintId: string | null;
  epicId: string | null;
  storyId: string | null;
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
  defaultStatus,
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
  // Create mode: seeds the status picker, so a column's own Add task lands the
  // new card in that column rather than always in To do.
  defaultStatus?: TaskStatus;
  // Edit mode: lets the board revalidate so the card's artifact chip catches
  // up after a link/unlink/upload (artifacts bypass the onPatch path).
  onArtifactsChanged?: () => void;
}) {
  const dialog = useDialog();
  const isCreate = !task;
  const os = useFeatureFlag("os-redesign");
  // The design opens a detail modal as a record — labels over plain values,
  // no footer — and the pencil turns it into a form. Creating is always a
  // form; there is no record yet to read.
  const [editing, setEditing] = useState(false);
  const readOnly = os && !isCreate && !editing;
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(
    task?.status ?? defaultStatus ?? "Todo",
  );
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignees.map((a) => a.id) ?? [],
  );
  const [dueDate, setDueDate] = useState<string>(
    task?.dueAt ? dateInputValue(task.dueAt) : "",
  );
  // Timeline start. Paired with the deadline it gives the task a span on the
  // planning timeline; left blank the bar inherits its story's span.
  const [startDate, setStartDate] = useState<string>(
    task?.startsAt ? dateInputValue(task.startsAt) : "",
  );
  const [storyId, setStoryId] = useState<string>(task?.storyId ?? "");
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
  // Stories always belong to an epic, so with no epic picked there's nothing
  // to choose from.
  const epicStories = epicId ? options.stories.filter((s) => s.epicId === epicId) : [];
  // Why a picker has nothing in it, said once under the field. Inside the
  // control it read as a value you could choose; the design's .field-hint is
  // where an explanation belongs.
  const sprintHint = epicSprints.length
    ? undefined
    : epicId
      ? "This epic has no sprints yet."
      : "Pick an epic first.";
  const storyHint = epicStories.length
    ? undefined
    : epicId
      ? "This epic has no user stories yet."
      : "Pick an epic first.";
  function changeEpic(next: string) {
    setEpicId(next);
    const stillValid = options.sprints.some(
      (s) => s.id === sprintId && (next ? s.epicId === next : s.epicId === null),
    );
    if (!stillValid) setSprintId("");
    if (!options.stories.some((s) => s.id === storyId && s.epicId === next)) {
      setStoryId("");
    }
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
  const [createBusy, setCreateBusy] = useState(false);
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
    setStatus(task.status);
    setAssigneeIds(task.assignees.map((a) => a.id));
    setDueDate(task.dueAt ? dateInputValue(task.dueAt) : "");
    setStartDate(task.startsAt ? dateInputValue(task.startsAt) : "");
    setStoryId(task.storyId ?? "");
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
    const nextDescription = description.trim() ? description : null;
    if (nextDescription !== current.description) patch.description = nextDescription;
    if (status !== current.status) patch.status = status;
    const nextDueIso = dueDate ? endOfDayIso(dueDate) : null;
    if (nextDueIso !== current.dueAt) patch.dueAt = nextDueIso;
    // Start is a plain UTC-midnight day, matching epic/sprint/story dates —
    // the deadline keeps its end-of-day semantics.
    const nextStartIso = startDate ? `${startDate}T00:00:00.000Z` : null;
    if (nextStartIso !== current.startsAt) patch.startsAt = nextStartIso;
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
    const nextStoryId = storyId === "" ? null : storyId;
    if (nextStoryId !== current.storyId) patch.storyId = nextStoryId;
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
  async function guardedClose() {
    if (
      isDirty() &&
      !(await dialog.confirm({
        title: "Discard unsaved changes?",
        confirmLabel: "Discard",
        tone: "destructive",
      }))
    )
      return;
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
        dueAt: dueDate ? endOfDayIso(dueDate) : null,
        startsAt: startDate ? `${startDate}T00:00:00.000Z` : null,
        domainId: domainId === "" ? null : domainId,
        assigneeIds,
        sprintId: sprintId === "" ? null : sprintId,
        epicId: epicId === "" ? null : epicId,
        storyId: storyId === "" ? null : storyId,
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
      author: { id: "", name: "You", photoUrl: null },
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

  // Create a brand-new GitHub issue for this task (no issueNumber → the server
  // files the issue via createIssueForTask and returns the mirror fields).
  async function handleCreateGithub() {
    if (!task) return;
    if (!linkRepo) {
      setLinkError("Select a repository.");
      return;
    }
    setCreateBusy(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/github`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: linkRepo }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        githubIssueNumber?: number;
        githubIssueUrl?: string;
      };
      if (!res.ok) throw new Error(j.error ?? `Request failed: ${res.status}`);
      setGithub({ issueNumber: j.githubIssueNumber ?? null, url: j.githubIssueUrl ?? null });
      setLinkOpen(false);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Couldn't create the issue.");
    } finally {
      setCreateBusy(false);
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-6 overflow-y-auto"
      containerClassName={cn(
        "w-full my-8 max-h-[85vh] flex flex-col",
        os
          ? // .modal-card: 560px, one column. The wide two-pane layout below is
            // the classic modal; the design puts the checklist under the task
            // rather than beside it.
            "max-w-[560px] os-modal-card os-form !p-0"
          : "max-w-4xl bg-card rounded-2xl shadow-brand-2",
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-3 flex-shrink-0",
          os ? "px-6 pt-6 pb-0" : "px-5 sm:px-6 py-4 border-b border-border",
        )}
      >
        {/* The design names which of epic / story / task you have open, in
            that level's own colours, before the title. */}
        {os && (
          <span className="os-type-badge os-type-badge--task mt-1.5 flex-shrink-0">Task</span>
        )}
        {os && isCreate ? (
          // Creating, the header names the dialog and the task's own name
          // moves into the first field below — which is where the design puts
          // it, and the only place a required mark can sit on it.
          <h2 id="task-modal-title" className="os-modal-title min-w-0 flex-1">
            New task
          </h2>
        ) : readOnly ? (
          // A record's title is text, not a field with a box around it.
          <h2
            id="task-modal-title"
            className="os-record-name os-modal-title min-w-0 flex-1 break-words"
          >
            {title}
          </h2>
        ) : (
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
        )}
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* The design's .modal-edit-btn — only where there's a record to
              switch out of, and only for someone who may change it. */}
          {readOnly && canManage && (
            <Tooltip content="Edit task">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="os-icon-btn"
                aria-label="Edit task"
              >
                <Pencil className="w-4 h-4" aria-hidden />
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            onClick={guardedClose}
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
      </div>

      {/* Two columns once there's room: the task itself on the left —
          description first, then its properties, artifacts and comment
          thread — with the checklist parked on the right so ticking
          subtasks off doesn't mean scrolling past every property. Each
          side scrolls independently past lg, so a long comment thread
          doesn't push the description out of view. */}
      <div
        className={cn(
          "flex-1 min-h-0 overflow-y-auto",
          os
            ? // No column gap: a .os-field-group carries its own 20px bottom
              // margin, and a gap here would space the paired fields twice.
              "px-6 pb-6 pt-6"
            : "lg:overflow-hidden grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 p-5 sm:p-6",
          readOnly && "os-form-readonly",
        )}
      >
        <div className={cn("min-h-0 lg:overflow-y-auto pr-1", !os && "flex flex-col gap-4")}>
        {os && isCreate && (
          <div className="os-field-group">
            <label htmlFor="task-title-field" className="os-field-label">
              Title<span className="os-required-mark">*</span>
            </label>
            <input
              id="task-title-field"
              type="text"
              autoFocus
              value={title}
              disabled={!canManage}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              className="w-full"
            />
          </div>
        )}

        <Field label="Description" hint="Markdown supported.">
          {/* Plain Markdown on Task.description, the same shape as the
              project's own Description block. Descriptions written back when
              this was a collab doc were already mirrored to this column as
              plaintext, so they still read fine here. */}
          {canManage ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={isCreate ? 3 : 6}
              placeholder="What does this task involve?"
              className="w-full px-2 py-1.5 text-sm font-mono border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          ) : description ? (
            <div className="px-2 py-1.5">
              <Markdown>{description}</Markdown>
            </div>
          ) : (
            <p className="px-2 py-1.5 text-sm text-muted-foreground italic">
              No description.
            </p>
          )}
        </Field>

        {/* The task's properties. The design pairs the fields that answer one
            question — the two ends of a span, domain with assignees — so the
            panel reads as a few decisions rather than a ladder of one-line
            rows, and fences the linked records off under their own heading. */}
        <div className={cn(!os && "rounded-lg border border-border divide-y divide-border")}>
          <PropRow label="Status">
            <Select
              value={status}
              disabled={!canManage}
              onChange={(value) => setStatus(value as TaskStatus)}
              options={TASK_STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABELS[s] }))}
              buttonClassName={PROP_CONTROL}
            />
          </PropRow>

          <FieldPair os={os}>
          <PropRow label="Starts">
            <DateField
              mode="date"
              value={startDate}
              disabled={!canManage}
              onChange={(value) => setStartDate(value)}
              className="w-full"
              ariaLabel="Start date"
            />
          </PropRow>
          <PropRow label="Deadline">
            <DateField
              mode="date"
              value={dueDate}
              disabled={!canManage}
              onChange={(value) => setDueDate(value)}
              className="w-full"
              ariaLabel="Deadline"
            />
          </PropRow>
          </FieldPair>

          <FieldPair os={os}>
          <PropRow label="Domain">
            <Select
              value={domainId}
              disabled={!canManage}
              onChange={(value) => setDomainId(value)}
              placeholder="—"
              options={[
                { value: "", label: "—" },
                ...options.domains.map((d) => ({ value: d.id, label: d.name })),
              ]}
              buttonClassName={PROP_CONTROL}
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
          </FieldPair>

          {os && (
            <>
              <div className="os-modal-divider" aria-hidden />
              <h3 className="os-section-header">Links</h3>
            </>
          )}

          <FieldPair os={os}>
          <PropRow label="Epic">
            <Select
              value={epicId}
              disabled={!canManage}
              onChange={(value) => changeEpic(value)}
              placeholder="No epic"
              options={[
                { value: "", label: "No epic" },
                ...options.epics.map((e) => ({ value: e.id, label: e.title })),
              ]}
              buttonClassName={PROP_CONTROL}
            />
          </PropRow>
          {!os && (
          <PropRow label="Sprint" hint={sprintHint}>
            <Tooltip
              variant="rich"
              content={
                epicSprints.length === 0
                  ? epicId
                    ? "This epic has no sprints yet. Sprints are added from the Progress tab."
                    : "Pick an epic first — sprints are scoped to an epic."
                  : null
              }
            >
              <span>
                <Select
                  value={sprintId}
                  disabled={!canManage || epicSprints.length === 0}
                  onChange={(value) => setSprintId(value)}
                  placeholder="None"
                  options={[
                    { value: "", label: "None" },
                    ...epicSprints.map((s) => ({
                      value: s.id,
                      label: `${s.name}${s.status === "Closed" ? " (closed)" : ""}`,
                    })),
                  ]}
                  buttonClassName={PROP_CONTROL}
                />
              </span>
            </Tooltip>
          </PropRow>
          )}
          </FieldPair>

          <PropRow label="User story" hint={storyHint}>
            <Tooltip
              variant="rich"
              content={
                epicStories.length === 0
                  ? epicId
                    ? "This epic has no user stories yet. Add stories from the Progress tab."
                    : "Pick an epic first — user stories are scoped to an epic."
                  : null
              }
            >
              <span>
                <Select
                  value={storyId}
                  disabled={!canManage || epicStories.length === 0}
                  onChange={(value) => setStoryId(value)}
                  placeholder="None"
                  options={[
                    { value: "", label: "None" },
                    ...epicStories.map((s) => ({ value: s.id, label: s.title })),
                  ]}
                  buttonClassName={PROP_CONTROL}
                />
              </span>
            </Tooltip>
          </PropRow>
        </div>

        {isCreate && canManage && githubRepos.length > 0 && (
          <ModalSection os={os} title="GitHub" className="gap-2">
            <Checkbox
              label="Create GitHub issue"
              checked={githubEnabled}
              onChange={(e) => setGithubEnabled(e.target.checked)}
              className="text-sm text-foreground"
            />
            {githubEnabled && (
              <Select
                value={githubRepo}
                onChange={(value) => setGithubRepo(value)}
                options={githubRepos.map((r) => ({ value: r, label: r }))}
                buttonClassName="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
              />
            )}
          </ModalSection>
        )}

        {!isCreate && task && (github.url || (canManage && githubRepos.length > 0)) && (
          <ModalSection os={os} title="GitHub" className="gap-2 text-xs">
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
                <Select
                  value={linkRepo}
                  onChange={(value) => setLinkRepo(value)}
                  options={githubRepos.map((r) => ({ value: r, label: r }))}
                  buttonClassName="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleCreateGithub()}
                    disabled={createBusy || linkBusy}
                  >
                    {createBusy ? "Creating…" : "Create new issue"}
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
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">or link existing</span>
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
                    disabled={linkBusy || createBusy || !linkIssueNumber}
                  >
                    {linkBusy ? "Linking…" : "Link"}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="self-start text-accent-coral hover:underline"
              >
                Add GitHub issue
              </button>
            )}
            {linkError && <p className="text-accent-coral">{linkError}</p>}
          </ModalSection>
        )}

        {!isCreate && task && (canManage || artifacts.length > 0) && (
          <ModalSection
            os={os}
            className="gap-2 text-xs"
            title={
              <>
                Work files
                {artifacts.length > 0 && ` (${artifacts.length})`}
              </>
            }
          >
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
                      <Select
                        value={attachFileId}
                        onChange={(value) => setAttachFileId(value)}
                        placeholder="Choose a file…"
                        options={[
                          { value: "", label: "Choose a file…" },
                          ...options.projectFiles
                            .filter((f) => !artifacts.some((a) => a.id === f.id))
                            .map((f) => ({ value: f.id, label: f.title })),
                        ]}
                        buttonClassName="px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
                      />
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
          </ModalSection>
        )}

        {!isCreate && task && (
          <ModalSection
            os={os}
            // os-live: commenting stays available on a read-only record.
            className="gap-3 os-live"
            title={
              <>
                Comments
                {comments !== null && ` (${comments.length})`}
              </>
            }
          >
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
                  <div className="flex flex-col gap-3.5 max-h-56 overflow-y-auto pr-1">
                    {comments.map((c) => (
                      <div key={c.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <Avatar photoUrl={c.author.photoUrl} name={c.author.name} size="xs" className="shrink-0" />
                          <span className="font-medium text-foreground">
                            {c.author.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatCommentAt(c.createdAt)}
                          </span>
                        </div>
                        {/* Indented to the avatar's right edge (w-5 + gap-2) so
                            the body hangs under the name rather than restarting
                            at the margin, which is what made consecutive
                            comments read as one block. */}
                        <p className="mt-1 pl-7 text-foreground whitespace-pre-wrap leading-relaxed">
                          {c.body}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {canManage && (
              <div className="flex flex-col gap-2 pt-1">
                <MentionTextInput
                  multiline
                  value={commentDraft}
                  onChange={setCommentDraft}
                  rows={2}
                  maxLength={COMMENT_MAX}
                  placeholder="Write a comment, @ to mention someone…"
                  className="w-full px-2.5 py-2 text-sm border border-border rounded-md bg-background text-foreground"
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
              </div>
            )}
          </ModalSection>
        )}
        </div>

        <div className={cn("min-h-0 lg:overflow-y-auto pr-1", !os && "flex flex-col gap-4")}>
        {!isCreate && (
          <ModalSection
            os={os}
            // Top of the classic modal's right column, so it takes no rule of
            // its own there; under os the columns stack and it needs one.
            bordered={false}
            className="gap-1.5 text-xs"
            title={
              <>
                Checklist
                {checklist.length > 0 && ` (${checklistDone}/${checklist.length})`}
              </>
            }
          >
            {checklist.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <Checkbox
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
          </ModalSection>
        )}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border px-5 sm:px-6 py-4 flex flex-col gap-2">
        {saveError && <p className="text-xs text-accent-coral">{saveError}</p>}

        <div className="flex items-center gap-2">
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
          <div className={cn("ml-auto flex gap-2", readOnly && "hidden")}>
            <button
              type="button"
              onClick={guardedClose}
              className={buttonClasses("secondary", "sm")}
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
                  onClick={() => {
                    setEditing(false);
                    void handleSave();
                  }}
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
  hint,
  children,
}: {
  label: string;
  // The design's .field-hint: what the field means or why it's empty, under
  // the control rather than inside it.
  hint?: string;
  children: React.ReactNode;
}) {
  const os = useFeatureFlag("os-redesign");
  return (
    <label className={cn(os ? "os-field-group" : "flex flex-col gap-1 text-xs")}>
      <span
        className={cn(
          os ? "os-field-label" : "text-muted-foreground font-medium uppercase tracking-wide",
        )}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span className={cn(os ? "os-field-hint" : "text-[11px] text-muted-foreground")}>
          {hint}
        </span>
      )}
    </label>
  );
}

// Two fields on one line (the design's .field-row). The classic panel doesn't
// pair — its rows are ruled, so they have to stay direct children of it.
function FieldPair({ os, children }: { os: boolean; children: React.ReactNode }) {
  return os ? <div className="os-field-row">{children}</div> : <>{children}</>;
}

// A block below the fields — links, attachments, comments. The design fences
// each with a rule and names it in caps; the classic modal uses a hairline and
// a quiet caption.
function ModalSection({
  os,
  title,
  className,
  bordered = true,
  children,
}: {
  os: boolean;
  title: React.ReactNode;
  className?: string;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {os && <div className="os-modal-divider" aria-hidden />}
      <div className={cn(!os && bordered && "pt-2 border-t border-border")}>
        <span
          className={cn(
            "block",
            os
              ? "os-section-header"
              : "mb-2 text-xs text-muted-foreground font-medium uppercase tracking-wide",
          )}
        >
          {title}
        </span>
        <div className={cn("flex flex-col", className)}>{children}</div>
      </div>
    </>
  );
}

// One field in the Details panel: the design stacks a caption over its value
// full width; the classic panel is a ruled two-column table.
function PropRow({
  label,
  hint,
  children,
  align = "center",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  const os = useFeatureFlag("os-redesign");
  if (os) {
    return (
      <div className="os-field-group min-w-0">
        <span className="os-field-label">{label}</span>
        <div className="min-w-0">{children}</div>
        {hint && <span className="os-field-hint">{hint}</span>}
      </div>
    );
  }
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
      <div className="flex-1 min-w-0">
        {children}
        {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
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
  all: { id: string; name: string; photoUrl?: string | null }[];
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
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

  const chosen = all.filter((m) => selected.includes(m.id));

  // Chips for who's on it, and everyone else behind a popover — rather than a
  // permanently-open bordered scroll box, which read as a panel inside the
  // properties panel and grew with the roster.
  return (
    <div ref={ref} className="relative flex flex-wrap items-center gap-1.5">
      {chosen.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 pl-0.5 pr-1.5 py-0.5 text-xs text-foreground"
        >
          <Avatar photoUrl={m.photoUrl} name={m.name} size="xs" className="shrink-0" />
          {m.name}
          {!disabled && (
            <button
              type="button"
              onClick={() => toggle(m.id)}
              aria-label={`Remove ${m.name}`}
              className="text-muted-foreground/70 hover:text-foreground rounded-full"
            >
              <X className="w-3 h-3" aria-hidden />
            </button>
          )}
        </span>
      ))}

      {!disabled && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-xs font-medium text-accent-coral hover:underline px-1 py-0.5"
        >
          {chosen.length === 0 ? "Assign someone" : "Edit"}
        </button>
      )}
      {disabled && chosen.length === 0 && (
        <span className="text-sm text-muted-foreground">Unassigned</span>
      )}

      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 max-h-56 w-60 overflow-y-auto rounded-md border border-border bg-card p-1 shadow-brand-2">
          {all.map((m) => (
            <Checkbox
              key={m.id}
              checked={selected.includes(m.id)}
              onChange={() => toggle(m.id)}
              label={
                <span className="flex items-center gap-2 min-w-0">
                  <Avatar
                    photoUrl={m.photoUrl}
                    name={m.name}
                    size="xs"
                    className="shrink-0"
                  />
                  <span className="truncate text-foreground">{m.name}</span>
                </span>
              }
              className="rounded px-1.5 py-1 text-sm hover:bg-muted/40 cursor-pointer"
            />
          ))}
        </div>
      )}
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
