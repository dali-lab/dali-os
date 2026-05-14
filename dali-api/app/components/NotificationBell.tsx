import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 60_000;

// Polls /api/notifications and returns the unread count. Used by the profile
// avatar to display a small badge.
export function useUnreadNotificationCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/notifications", { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as { unreadCount?: number };
        if (cancelled) return;
        setCount(typeof json.unreadCount === "number" ? json.unreadCount : 0);
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
  return count;
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
