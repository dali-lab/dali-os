import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Users } from "lucide-react";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";
import { Avatar } from "~/components/ui/Avatar";

export type PersonOption = { id: string; name: string; photoUrl?: string | null };

// The task board's "All people" control: a pill that opens a checkbox list of
// people, each with their avatar. Selection is owned by the caller — the board
// keeps it in the URL (a person-sliced view is shareable), the task modal keeps
// it in form state (a task's assignees). Reused for both so assignment and
// filtering wear the same control.
export function PeopleFilter({
  options,
  selected,
  onChange,
  disabled = false,
  emptyLabel = "All people",
  clearLabel = "Clear filter",
}: {
  options: PersonOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Read-only surface (e.g. a task you can't edit): shows who, no dropdown. */
  disabled?: boolean;
  /** Trigger text when nobody is chosen — "All people" filtering, "Assign someone" for assignment. */
  emptyLabel?: string;
  /** Footer action label — "Clear filter" vs "Clear". */
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = new Set(selected);
  // Ordered by the option list so the avatar stack and label stay stable as
  // people are toggled.
  const chosen = options.filter((o) => selectedSet.has(o.id));
  const label =
    chosen.length === 0
      ? emptyLabel
      : chosen.length === 1
        ? chosen[0].name
        : `${chosen.length} people`;

  const toggle = (id: string) =>
    onChange(
      selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
          chosen.length > 0
            ? "border-os-accent/60 text-foreground"
            : "border-os-container text-foreground",
          disabled ? "cursor-default" : "hover:bg-os-container",
        )}
      >
        {chosen.length > 0 ? (
          // Who's chosen, read at a glance — the same faces the dropdown lists.
          <span className="flex -space-x-1.5">
            {chosen.slice(0, 3).map((o) => (
              <Avatar
                key={o.id}
                photoUrl={o.photoUrl}
                name={o.name}
                size="xs"
                className="ring-1 ring-os-card"
              />
            ))}
          </span>
        ) : (
          <Users className="h-[17px] w-[17px] text-os-muted" aria-hidden />
        )}
        <span className="truncate max-w-[160px]">{label}</span>
        {!disabled && (
          <ChevronsUpDown className="h-4 w-4 text-os-muted" aria-hidden />
        )}
      </button>

      {open && !disabled && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+8px)] z-[100] max-h-80 min-w-[248px] overflow-y-auto rounded-xl border border-os-container bg-os-card p-1.5 shadow-[0_12px_32px_var(--color-os-shadow)]"
        >
          {options.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-os-muted">No one to choose yet.</p>
          )}
          {options.map((o) => (
            <Checkbox
              key={o.id}
              checked={selectedSet.has(o.id)}
              onChange={() => toggle(o.id)}
              className="w-full !items-center rounded-lg px-2.5 py-2 transition-colors hover:bg-os-container"
              label={
                <span className="flex items-center gap-2.5">
                  <Avatar
                    photoUrl={o.photoUrl}
                    name={o.name}
                    size="sm"
                    className="flex-shrink-0"
                  />
                  <span className="truncate">{o.name}</span>
                </span>
              }
            />
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-lg border-t border-os-container px-2.5 py-2 text-left text-sm text-os-muted transition-colors hover:text-foreground"
            >
              {clearLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
