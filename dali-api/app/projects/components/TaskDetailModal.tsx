import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import type { Sprint, Epic } from "~/generated/prisma/client";
import type { TaskWithRelations } from "~/projects/lib/queries";
import { broadcastBoardEvent } from "./useBoardSync";

type ChecklistItem = { text: string; done: boolean };

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string };
}

interface Props {
  projectId: string;
  task: TaskWithRelations;
  sprints: Sprint[];
  epics: Epic[];
  canEdit: boolean;
  viewer: { id: string; firstName: string; lastName: string };
  collabToken: string | null;
  onClose: () => void;
  onChanged: () => void;
}

const STATUSES = ["Todo", "InProgress", "InReview", "Done", "Cancelled"] as const;
const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;

export function TaskDetailModal({
  projectId,
  task,
  sprints,
  epics,
  canEdit,
  viewer,
  collabToken,
  onClose,
  onChanged,
}: Props) {
  const [title, setTitle] = useState(task.title);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() =>
    Array.isArray(task.checklist) ? (task.checklist as ChecklistItem[]) : [],
  );
  const [newChecklistItem, setNewChecklistItem] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch(
        `/api/projects/${projectId}/tasks/${task.id}/comments`,
      );
      if (res.ok) setComments(await res.json());
    })().catch(() => {});
  }, [projectId, task.id]);

  async function patch(data: Record<string, unknown>) {
    await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    broadcastBoardEvent({
      kind: "task.updated",
      projectId,
      entityId: task.id,
      ts: Date.now(),
    });
    onChanged();
  }

  async function postComment() {
    if (!newComment.trim() || postingComment) return;
    setPostingComment(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/tasks/${task.id}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: newComment.trim() }),
        },
      );
      if (res.ok) {
        const c: Comment = await res.json();
        setComments((cs) => [...cs, c]);
        setNewComment("");
      }
    } finally {
      setPostingComment(false);
    }
  }

  async function saveChecklist(next: ChecklistItem[]) {
    setChecklist(next);
    await patch({ checklist: next });
  }

  async function deleteTask() {
    if (!confirm("Delete this task?")) return;
    await fetch(`/api/projects/${projectId}/tasks/${task.id}`, { method: "DELETE" });
    broadcastBoardEvent({
      kind: "task.deleted",
      projectId,
      entityId: task.id,
      ts: Date.now(),
    });
    onChanged();
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="task-detail-title"
      containerClassName="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-5 sm:p-6 my-auto max-h-[90vh] overflow-y-auto"
    >
      <header className="flex items-start gap-3 mb-4">
        <input
          id="task-detail-title"
          value={title}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (title.trim() && title !== task.title) patch({ title: title.trim() });
          }}
          className="flex-1 min-w-0 text-lg font-semibold bg-transparent border-0 border-b border-transparent hover:border-border focus:border-border focus:outline-none px-0 py-1"
        />
        {canEdit && (
          <button
            onClick={deleteTask}
            className="text-muted-foreground hover:text-destructive p-1"
            aria-label="Delete task"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        <Selector
          label="Status"
          value={task.status}
          disabled={!canEdit}
          options={STATUSES.map((s) => ({ value: s, label: s }))}
          onChange={(v) => {
            patch({ status: v });
            broadcastBoardEvent({
              kind: "task.moved",
              projectId,
              entityId: task.id,
              ts: Date.now(),
            });
          }}
        />
        <Selector
          label="Priority"
          value={task.priority}
          disabled={!canEdit}
          options={PRIORITIES.map((p) => ({ value: p, label: p }))}
          onChange={(v) => patch({ priority: v })}
        />
        <Selector
          label="Sprint"
          value={task.sprintId ?? ""}
          disabled={!canEdit}
          options={[
            { value: "", label: "Backlog" },
            ...sprints.map((s) => ({ value: s.id, label: s.name })),
          ]}
          onChange={(v) => patch({ sprintId: v || null })}
        />
        <Selector
          label="Epic"
          value={task.epicId ?? ""}
          disabled={!canEdit}
          options={[
            { value: "", label: "No epic" },
            ...epics.map((e) => ({ value: e.id, label: e.title })),
          ]}
          onChange={(v) => patch({ epicId: v || null })}
        />
      </div>

      <section className="mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Description
        </h3>
        {collabToken ? (
          <CollaborativeEditor
            documentName={`task:${task.id}:description`}
            token={collabToken}
            userName={`${viewer.firstName} ${viewer.lastName}`.trim() || "DALI member"}
            editorId={`task-desc-${task.id}`}
            disabled={!canEdit}
            placeholder="What does done look like?"
          />
        ) : (
          <p className="text-xs text-muted-foreground italic">
            Sign in again to edit the description.
          </p>
        )}
      </section>

      <section className="mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Checklist
        </h3>
        <ul className="space-y-1">
          {checklist.map((item, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canEdit}
                onChange={() => {
                  const next = [...checklist];
                  next[i] = { ...item, done: !item.done };
                  saveChecklist(next);
                }}
              />
              <span className={item.done ? "line-through text-muted-foreground" : ""}>
                {item.text}
              </span>
              {canEdit && (
                <button
                  onClick={() => {
                    const next = checklist.filter((_, j) => j !== i);
                    saveChecklist(next);
                  }}
                  className="ml-auto text-xs text-muted-foreground hover:text-destructive"
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="mt-2 flex gap-2">
            <input
              value={newChecklistItem}
              onChange={(e) => setNewChecklistItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newChecklistItem.trim()) {
                  saveChecklist([
                    ...checklist,
                    { text: newChecklistItem.trim(), done: false },
                  ]);
                  setNewChecklistItem("");
                }
              }}
              placeholder="Add a checklist item"
              className="flex-1 rounded-lg border border-border bg-card px-2 py-1 text-sm"
            />
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Comments ({comments.length})
        </h3>
        <ul className="space-y-3 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="font-medium text-foreground">
                {c.author.firstName} {c.author.lastName}{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  · {new Date(c.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap mt-0.5">{c.body}</p>
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="flex gap-2">
            <textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Add a comment"
              className="flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
              rows={2}
            />
            <Button size="sm" onClick={postComment} disabled={postingComment}>
              Post
            </Button>
          </div>
        )}
      </section>
    </Modal>
  );
}

function Selector({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="text-xs flex flex-col gap-1">
      <span className="text-muted-foreground font-medium">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
