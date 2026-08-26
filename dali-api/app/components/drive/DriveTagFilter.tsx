import { Check, ChevronDown, Tag as TagIcon, X } from "lucide-react";
import { Popover } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";

export type FilterTag = { id: string; label: string; color: string | null };

// A hex color is safe to drop straight into an inline style; a Tailwind token
// (the other thing DocTag.color may hold) is not, so we only show the swatch
// for hex values and skip it otherwise rather than render a broken dot.
function hexColor(color: string | null): string | undefined {
  return color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : undefined;
}

// The Drive tag filter as a compact multi-select dropdown — the same move the
// type filter made from a chip row to a Select pill, applied to tags. The pill
// shows how many tags are active; the panel is a checklist that toggles each
// tag in place (the popover stays open so several can be picked at once). The
// active tags themselves render as removable chips under the toolbar (owned by
// the hub), so this control stays one compact pill no matter how many tags the
// lab has.
export function DriveTagFilter({
  tags,
  selectedIds,
  onToggle,
  onClear,
  os,
}: {
  tags: FilterTag[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  os: boolean;
}) {
  const count = selectedIds.size;
  const label = count === 0 ? "Tags" : count === 1 ? "1 tag" : `${count} tags`;

  return (
    <Popover
      align="left"
      ariaLabel="Filter by tag"
      trigger={(open) => (
        <button
          type="button"
          aria-label="Filter by tag"
          aria-pressed={count > 0}
          className={cn(
            filterPillClass(os),
            "w-full sm:w-44",
            count > 0 &&
              (os
                ? "border-os-accent text-os-accent"
                : "border-accent-coral text-accent-coral"),
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <TagIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      )}
    >
      {() => (
        <div className="min-w-[12rem] max-w-[16rem]">
          {tags.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No tags yet.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-0.5" role="group" aria-label="Tags">
              {tags.map((tag) => {
                const active = selectedIds.has(tag.id);
                const swatch = hexColor(tag.color);
                return (
                  <li key={tag.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => onToggle(tag.id)}
                      className={cn(
                        "flex w-full items-center gap-2 text-left text-sm transition-colors",
                        os ? "rounded-lg px-3 py-2" : "rounded px-2 py-1.5",
                        active
                          ? "bg-accent-coral/5 text-accent-coral"
                          : "text-foreground hover:bg-muted/50",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-accent-coral",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {swatch && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: swatch }}
                        />
                      )}
                      <span className="truncate">{tag.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {count > 0 && (
            <div className="mt-0.5 border-t border-border pt-0.5">
              <button
                type="button"
                onClick={onClear}
                className={cn(
                  "flex w-full items-center gap-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground",
                  os ? "rounded-lg px-3 py-2 hover:bg-os-container" : "rounded px-2 py-1.5 hover:bg-muted/50",
                )}
              >
                <X className="h-3.5 w-3.5 shrink-0" />
                Clear tags
              </button>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}
