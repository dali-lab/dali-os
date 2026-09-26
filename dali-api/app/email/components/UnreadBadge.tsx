import { cn } from "~/lib/cn";

// The yellow unread count on inbox rows and the sidebar's Email entry.
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "min-w-[18px] shrink-0 rounded-full bg-accent-yellow px-1.5 text-center text-[11px] font-bold leading-[18px] text-black",
        className,
      )}
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
