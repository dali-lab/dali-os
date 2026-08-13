import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";

const POLL_INTERVAL_MS = 60_000;

// Same-window event that forces an immediate poll, so an action that changes
// the task list (e.g. confirming a task on Home) updates the sidebar at once
// instead of waiting up to a full poll interval. The shell relays the
// cross-frame `dali:tasksChanged` postMessage into this event — see Layout.tsx.
export const TASKS_CHANGED_EVENT = "dali:tasksChanged";

// Open task (todo). Mirrors the `Task` shape from ~/lib/tasks, but only the
// fields the sidebar needs — kept local so this client module doesn't import
// server code.
export type OpenTask = {
  id: string;
  title: string;
  link: string | null;
  source?: "meeting" | "reminder" | "announcement" | "general";
  // Self-clearing task (form to submit, onboarding) — opening its link must
  // not mark it read. Optional so a stale payload falls back to the old
  // behavior; the server refuses the read either way.
  hasAction?: boolean;
};

type Polled = {
  taskCount: number;
  tasks: OpenTask[];
};

// Polls /api/notifications once and returns the open-task count and the
// open-task list. A single poll backs the sidebar Tasks group's count and list
// so they never disagree.
function usePolledCounts(): Polled {
  const [state, setState] = useState<Polled>({
    taskCount: 0,
    tasks: [],
  });
  const { revalidate } = useRevalidator();
  // Stable ref so the once-mounted SSE listener always calls the latest
  // revalidate without needing to re-subscribe (mirrors StaffingBoard).
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/notifications", { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          taskCount?: number;
          tasks?: OpenTask[];
        };
        if (cancelled) return;
        const tasks = Array.isArray(json.tasks) ? json.tasks : [];
        setState({
          taskCount:
            typeof json.taskCount === "number" ? json.taskCount : tasks.length,
          tasks,
        });
      } catch {
        // Polling errors are benign; we'll try again next tick.
      }
    };
    refresh();
    const id = window.setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener(TASKS_CHANGED_EVENT, refresh);

    // SSE stream for sub-second delivery on the same machine; `sync` every
    // 60s is the cross-instance backstop when prod runs multiple servers.
    // EventSource auto-reconnects, so a dropped connection self-heals.
    const es = new EventSource("/api/notifications/stream", {
      withCredentials: true,
    });
    const onPush = () => {
      void refresh();
      revalidateRef.current();
    };
    es.addEventListener("change", onPush);
    es.addEventListener("sync", onPush);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener(TASKS_CHANGED_EVENT, refresh);
      es.close();
    };
  }, []);
  return state;
}

// Open-task count for the sidebar Tasks indicator. Always renders a number
// (0 when nothing is pending), so callers can show "Tasks 0".
export function useOpenTaskCount(): number {
  return usePolledCounts().taskCount;
}

// Open-task list for the sidebar Tasks group — one entry per todo, each
// linking to that todo's own target.
export function useOpenTasks(): OpenTask[] {
  return usePolledCounts().tasks;
}
