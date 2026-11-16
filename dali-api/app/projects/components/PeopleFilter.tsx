import { ChevronsUpDown, Users } from "lucide-react";
import { cn } from "~/lib/cn";
import { Avatar } from "~/components/ui/Avatar";
import { MultiSelect } from "~/components/ui/floating";

export type PersonOption = { id: string; name: string; photoUrl?: string | null };

// The task board's "All people" control. Selection is owned by the caller — the
// board keeps it in the URL (a person-sliced view is shareable), the task modal
// keeps it in form state (a task's assignees).
export function PeopleFilter({
  options,
  selected,
  onChange,
  disabled = false,
  emptyLabel = "All people",
  clearLabel = "Clear filter",
  ariaLabel = "People",
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
  ariaLabel?: string;
}) {
  const people = new Map(options.map((o) => [o.id, o]));
  const hasChosen = selected.some((id) => people.has(id));

  return (
    <MultiSelect
      values={selected}
      onChange={onChange}
      disabled={disabled}
      ariaLabel={ariaLabel}
      chips={false}
      clearLabel={clearLabel}
      searchPlaceholder="Search people"
      options={options.map((o) => ({
        value: o.id,
        label: o.name,
        icon: <Avatar photoUrl={o.photoUrl} name={o.name} size="xs" className="shrink-0" />,
      }))}
      buttonClassName={cn(
        "!justify-start gap-2 rounded-full border px-3.5 py-2 text-sm font-medium text-foreground transition-colors disabled:!opacity-100",
        hasChosen ? "border-os-accent/60" : "border-os-container",
        disabled ? "cursor-default" : "hover:bg-os-container",
      )}
      renderTrigger={({ chosen }) => (
        <>
          {chosen.length > 0 ? (
            <span className="flex -space-x-1.5">
              {chosen.slice(0, 3).map((o) => (
                <Avatar
                  key={o.value}
                  photoUrl={people.get(o.value)?.photoUrl}
                  name={o.label}
                  size="xs"
                  className="ring-1 ring-os-card"
                />
              ))}
            </span>
          ) : (
            <Users className="h-[17px] w-[17px] text-os-muted" aria-hidden />
          )}
          <span className="max-w-[160px] truncate">
            {chosen.length === 0
              ? emptyLabel
              : chosen.length === 1
                ? chosen[0].label
                : `${chosen.length} people`}
          </span>
          {!disabled && <ChevronsUpDown className="h-4 w-4 text-os-muted" aria-hidden />}
        </>
      )}
    />
  );
}
