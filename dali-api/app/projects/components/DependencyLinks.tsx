import { cn } from "~/lib/cn";

export type DependencyLink = {
  id: string;
  label: string;
  // Still unfinished. On a "Blocked by" list that is what holds the item up,
  // so it gets the amber dot; finished links read as settled.
  open: boolean;
};

/**
 * One side of a dependency edge, read-only: the epics, stories or tasks an
 * item waits on, or the ones waiting on it. Each link opens that item when
 * `onSelect` is given. Shared by the task modal and the epic/story views so
 * all three levels show their edges the same way.
 */
export function DependencyLinks({
  items,
  onSelect,
  empty = "None",
}: {
  items: DependencyLink[];
  onSelect?: (id: string) => void;
  empty?: string;
}) {
  if (items.length === 0) {
    return <span className="text-sm text-os-grey">{empty}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const body = (
          <>
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                item.open ? "bg-os-amber" : "bg-os-grey/50",
              )}
            />
            <span className="truncate">{item.label}</span>
          </>
        );
        const chip =
          "inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-os-container px-2 py-0.5 text-xs text-foreground";
        return (
          <li key={item.id} className="min-w-0">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className={cn(chip, "transition-colors hover:bg-os-container")}
              >
                {body}
              </button>
            ) : (
              <span className={chip}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
