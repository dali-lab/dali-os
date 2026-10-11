import { useEffect, useState } from "react";
import { cn } from "~/lib/cn";
import { formatDateShort } from "~/lib/display";
import { TASK_STATUS_LABELS, type TaskStatus } from "~/projects/lib/task-board";

// Status/assignee/due-date resolution for a taskMention chip (mention.tsx
// renders the chip + hover card via the shared Tooltip primitive, passing
// this module's hook/content builder in). Mirrors MentionHoverCard's
// module-level cache — a document can repeat the same task many times, and
// re-fetching per chip would be needless traffic.
//
// taskId/projectId/label are the only bits stored on the node itself (see
// taskMentionConfig) — status, assignee, and due date are live task state,
// so they're fetched here rather than snapshotted into the document.

type CardTask = {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: { name: string } | null;
  dueAt: string | null;
};

const cache = new Map<string, CardTask | null>();
const inflight = new Map<string, Promise<CardTask | null>>();

async function loadTask(id: string): Promise<CardTask | null> {
  if (cache.has(id)) return cache.get(id)!;
  const existing = inflight.get(id);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      return (await res.json()) as CardTask;
    } catch {
      return null;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  const task = await p;
  cache.set(id, task);
  return task;
}

/** Status→color for the chip's dot and the hover card's status line. Mirrors
 *  the task board's own status accents (TaskBoard.tsx's STATUS_ACCENT_OS
 *  `edge` colors) without importing that component-local map. */
const STATUS_DOT_COLOR: Record<TaskStatus, string> = {
  Backlog: "var(--color-brand-gray)",
  Todo: "#7c5ce0",
  InProgress: "var(--color-accent-teal)",
  InReview: "var(--color-accent-yellow)",
  Done: "var(--color-accent-green)",
  Cancelled: "var(--color-border)",
};

/** Resolves a task's live card data, lazily (only once a chip for that
 *  taskId actually renders) and cached module-wide so repeat chips — in this
 *  document or another — are instant. Returns "loading" until the first
 *  fetch for `taskId` settles, then the result (null on error/no-access).
 *  Call once per chip — both the status dot and the hover card read off the
 *  same instance so only one fetch fires per chip. */
export function useTaskMentionCard(taskId: string): CardTask | null | "loading" {
  const [state, setState] = useState<CardTask | null | "loading">(() =>
    taskId && cache.has(taskId) ? cache.get(taskId)! : "loading",
  );

  useEffect(() => {
    if (!taskId) {
      setState(null);
      return;
    }
    if (cache.has(taskId)) {
      setState(cache.get(taskId)!);
      return;
    }
    let active = true;
    setState("loading");
    void loadTask(taskId).then((task) => {
      if (active) setState(task);
    });
    return () => {
      active = false;
    };
  }, [taskId]);

  return state;
}

export function TaskStatusDot({
  status,
  className,
}: {
  status: TaskStatus | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", className)}
      style={{
        backgroundColor: status ? STATUS_DOT_COLOR[status] : "var(--color-muted-foreground)",
      }}
    />
  );
}

/** The hover card's body, built from whatever useTaskMentionCard currently
 *  has — loading placeholder, the stored label on error/no-access, or the
 *  full status/assignee/due-date panel. */
export function taskMentionHoverContent(task: CardTask | null | "loading", fallbackLabel: string) {
  if (task === "loading") {
    return <span className="text-muted-foreground">Loading…</span>;
  }
  if (!task) {
    return <span className="font-medium text-foreground">{fallbackLabel}</span>;
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 font-medium text-foreground">
        <TaskStatusDot status={task.status} />
        {task.title || fallbackLabel}
      </span>
      <span className="text-muted-foreground">{TASK_STATUS_LABELS[task.status]}</span>
      {task.assignee && (
        <span className="text-muted-foreground">Assigned to {task.assignee.name}</span>
      )}
      {task.dueAt && (
        <span className="text-muted-foreground">Due {formatDateShort(task.dueAt)}</span>
      )}
    </span>
  );
}
