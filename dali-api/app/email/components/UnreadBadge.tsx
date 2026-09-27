import { cn } from "~/lib/cn";

// The yellow unread count on inbox rows and the sidebar's Email entry.
// Fixed dark text: dark mode rewrites .text-black to near-white, but the yellow stays bright.
export function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "min-w-[18px] shrink-0 rounded-full bg-accent-yellow px-1.5 text-center text-[11px] font-bold leading-[18px] text-[#1f1f1f]",
        className,
      )}
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
