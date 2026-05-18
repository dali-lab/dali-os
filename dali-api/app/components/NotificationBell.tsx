import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 60_000;

// Open task (todo). Mirrors the `Task` shape from ~/lib/tasks, but only the
// fields the sidebar needs — kept local so this client module doesn't import
// server code.
export type OpenTask = {
  id: string;
  title: string;
  link: string | null;
};

type Polled = {
  unreadCount: number;
  taskCount: number;
  tasks: OpenTask[];
};

// Polls /api/notifications once and returns the unread-notification count, the
// open-task count, and the open-task list. A single poll backs the avatar
// badge and the sidebar Tasks group so they never disagree.
function usePolledCounts(): Polled {
  const [state, setState] = useState<Polled>({
    unreadCount: 0,
    taskCount: 0,
    tasks: [],
  });
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/notifications", { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          unreadCount?: number;
          taskCount?: number;
          tasks?: OpenTask[];
        };
        if (cancelled) return;
        const tasks = Array.isArray(json.tasks) ? json.tasks : [];
        setState({
          unreadCount: typeof json.unreadCount === "number" ? json.unreadCount : 0,
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
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return state;
}

// Unread-notification count for the profile avatar badge.
export function useUnreadNotificationCount(): number {
  return usePolledCounts().unreadCount;
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

// Small red bubble showing the unread count, positioned absolutely so callers
// can drop it on top of an avatar with relative positioning.
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent-coral text-white text-[10px] font-bold flex items-center justify-center pointer-events-none"
      aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
