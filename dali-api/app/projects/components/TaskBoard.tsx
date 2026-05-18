import { useState } from "react";
import type { TaskStatus } from "~/generated/prisma/client";
import type { TaskWithRelations } from "~/projects/lib/queries";
import { broadcastBoardEvent } from "./useBoardSync";

interface Props {
  projectId: string;
  tasks: TaskWithRelations[];
  canEdit: boolean;
  onSelect: (taskId: string) => void;
  onChanged: () => void;
}

const COLUMNS: TaskStatus[] = ["Todo", "InProgress", "InReview", "Done", "Cancelled"];
const COLUMN_LABEL: Record<TaskStatus, string> = {
  Todo: "To do",
  InProgress: "In progress",
  InReview: "In review",
  Done: "Done",
  Cancelled: "Cancelled",
};
const PRIORITY_COLOR: Record<string, string> = {
  Low: "bg-muted text-muted-foreground",
  Normal: "",
  High: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  Urgent: "bg-destructive/15 text-destructive",
};

export function TaskBoard({
  projectId,
  tasks,
  canEdit,
  onSelect,
  onChanged,
}: Props) {
  const [dragging, setDragging] = useState<TaskWithRelations | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);

  const byStatus = new Map<TaskStatus, TaskWithRelations[]>();
  for (const status of COLUMNS) byStatus.set(status, []);
  for (const t of tasks) {
    const bucket = byStatus.get(t.status);
    if (bucket) bucket.push(t);
  }

  async function moveTask(task: TaskWithRelations, toStatus: TaskStatus) {
    if (task.status === toStatus) return;
    // Optimistic broadcast
    broadcastBoardEvent({
      kind: "task.moved",
      projectId,
      entityId: task.id,
      ts: Date.now(),
    });
    await fetch(`/api/projects/${projectId}/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: toStatus }),
    });
    onChanged();
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {COLUMNS.map((status) => {
        const items = byStatus.get(status) ?? [];
        return (
          <div
            key={status}
            data-column={status}
            onDragOver={(e) => {
              if (!canEdit || !dragging) return;
              e.preventDefault();
              setOverColumn(status);
            }}
            onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              if (!canEdit || !dragging) return;
              moveTask(dragging, status);
              setDragging(null);
              setOverColumn(null);
            }}
            className={`min-h-[120px] rounded-xl border ${
              overColumn === status
                ? "border-accent-coral bg-accent-coral/5"
                : "border-border bg-card/30"
            } p-2 flex flex-col gap-2`}
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 flex items-center justify-between">
              <span>{COLUMN_LABEL[status]}</span>
              <span>{items.length}</span>
            </div>
            {items.map((t) => (
              <article
                key={t.id}
                draggable={canEdit}
                onDragStart={() => setDragging(t)}
                onDragEnd={() => {
                  setDragging(null);
                  setOverColumn(null);
                }}
                onClick={() => onSelect(t.id)}
                className="rounded-lg border border-border bg-card p-2.5 text-sm shadow-sm hover:border-accent-coral/50 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-foreground line-clamp-2">
                    {t.title}
                  </div>
                  {t.priority !== "Normal" && (
                    <span
                      className={`text-[10px] uppercase font-semibold tracking-wider px-1.5 py-0.5 rounded ${PRIORITY_COLOR[t.priority]}`}
                    >
                      {t.priority}
                    </span>
                  )}
                </div>
                {t.assignees.length > 0 && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    {t.assignees
                      .map((a) => `${a.user.firstName} ${a.user.lastName[0]}.`)
                      .join(", ")}
                  </div>
                )}
                {(t.comments > 0 || hasChecklist(t.checklist)) && (
                  <div className="mt-1 text-[11px] text-muted-foreground flex gap-3">
                    {t.comments > 0 && <span>💬 {t.comments}</span>}
                    {hasChecklist(t.checklist) && <span>☑︎ checklist</span>}
                  </div>
                )}
              </article>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function hasChecklist(c: unknown): boolean {
  return Array.isArray(c) && c.length > 0;
}
