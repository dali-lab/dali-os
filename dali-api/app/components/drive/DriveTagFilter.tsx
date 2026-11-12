import { ChevronDown, Tag as TagIcon } from "lucide-react";
import { MultiSelect, toggledValue } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { cn } from "~/lib/cn";
import { hexColor } from "~/lib/drive-tags";

export type FilterTag = { id: string; label: string; color: string | null };

// The active tags render as removable chips under the toolbar (owned by the
// hub), so this control stays one compact pill no matter how many tags the lab
// has.
export function DriveTagFilter({
  tags,
  selectedIds,
  onToggle,
  onClear,
}: {
  tags: FilterTag[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const values = tags.filter((t) => selectedIds.has(t.id)).map((t) => t.id);
  const count = selectedIds.size;
  const label = count === 0 ? "Tags" : count === 1 ? "1 tag" : `${count} tags`;

  return (
    <MultiSelect
      values={values}
      onChange={(next) => {
        if (next.length === 0) return onClear();
        const changed = toggledValue(values, next);
        if (changed) onToggle(changed);
      }}
      options={tags.map((t) => {
        const swatch = hexColor(t.color);
        return {
          value: t.id,
          label: t.label,
          icon: swatch ? (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: swatch }} />
          ) : undefined,
        };
      })}
      searchable
      chips={false}
      ariaLabel="Filter by tag"
      searchPlaceholder="Filter tags"
      noMatchesLabel="No tags match."
      clearLabel="Clear tags"
      buttonClassName={cn(filterPillClass(), "w-full sm:w-44", count > 0 && "border-os-accent text-os-accent")}
      renderTrigger={({ open }) => (
        <>
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
        </>
      )}
    />
  );
}
