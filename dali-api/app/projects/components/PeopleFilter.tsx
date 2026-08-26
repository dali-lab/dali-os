import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, Users } from "lucide-react";
import { cn } from "~/lib/cn";
import { Checkbox } from "~/components/ui/Checkbox";

export type PersonOption = { id: string; name: string };

// The Progress toolbar's "All people" filter: a pill that opens a checkbox
// list of the people who hold work on this project. Selection is owned by the
// caller (it lives in the URL so a person-sliced view is shareable) — this is
// the control, not the state.
export function PeopleFilter({
  options,
  selected,
  onChange,
}: {
  options: PersonOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
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
  const label =
    selected.length === 0
      ? "All people"
      : selected.length === 1
        ? (options.find((o) => o.id === selected[0])?.name ?? "1 person")
        : `${selected.length} people`;

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
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
          selected.length > 0
            ? "border-os-accent/60 text-foreground"
            : "border-os-container text-foreground hover:bg-os-container",
        )}
      >
        <Users className="h-[17px] w-[17px] text-os-muted" aria-hidden />
        <span className="truncate max-w-[160px]">{label}</span>
        <ChevronsUpDown className="h-4 w-4 text-os-muted" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+8px)] z-[100] max-h-80 min-w-[248px] overflow-y-auto rounded-xl border border-os-container bg-os-card p-1.5 shadow-[0_12px_32px_var(--color-os-shadow)]"
        >
          {options.map((o) => (
            <Checkbox
              key={o.id}
              checked={selectedSet.has(o.id)}
              onChange={() => toggle(o.id)}
              className="w-full !items-center rounded-lg px-2.5 py-2 transition-colors hover:bg-os-container"
              label={
                <span className="flex items-center gap-2.5">
                  <span className="h-6 w-6 flex-shrink-0 rounded-full bg-gradient-to-b from-os-hover to-os-container" />
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
              Clear filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
