import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/Button";
import type { Sprint, Epic } from "~/generated/prisma/client";
import { broadcastBoardEvent } from "./useBoardSync";

interface Props {
  projectId: string;
  sprints: Sprint[];
  epics: Epic[];
  defaultSprintId: string | null;
  onCreated: () => void;
}

export function TaskCreateInline({
  projectId,
  sprints,
  epics,
  defaultSprintId,
  onCreated,
}: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [sprintId, setSprintId] = useState<string | "">(defaultSprintId ?? "");
  const [epicId, setEpicId] = useState<string | "">("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          sprintId: sprintId || null,
          epicId: epicId || null,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        broadcastBoardEvent({
          kind: "task.created",
          projectId,
          entityId: created.id,
          ts: Date.now(),
        });
        setTitle("");
        setOpen(false);
        onCreated();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Plus className="w-3.5 h-3.5" />
        New task
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-2">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !submitting) submit();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Task title"
        className="flex-1 min-w-[200px] rounded-lg border border-border bg-card px-3 py-1.5 text-sm"
      />
      <select
        value={sprintId}
        onChange={(e) => setSprintId(e.target.value)}
        className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
      >
        <option value="">Backlog</option>
        {sprints
          .filter((s) => s.status !== "Closed")
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>
      {epics.length > 0 && (
        <select
          value={epicId}
          onChange={(e) => setEpicId(e.target.value)}
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
        >
          <option value="">No epic</option>
          {epics
            .filter((e) => e.status !== "Done" && e.status !== "Cancelled")
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
        </select>
      )}
      <Button size="sm" onClick={submit} disabled={submitting}>
        {submitting ? "Adding…" : "Add"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
