import { cn } from "~/lib/cn";

/** Marks an event missing a required field: a flat, bright red dot with a white "!". */
export function IssueIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#ff4757] text-[11px] font-extrabold leading-none text-white",
        className,
      )}
      aria-hidden
    >
      !
    </span>
  );
}
