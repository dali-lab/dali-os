import { Avatar } from "~/components/ui/Avatar";
import { Combobox } from "~/components/ui/floating/Combobox";
import { cn } from "~/lib/cn";
import { orderMembers, pinnedMembers, toggleAssignee } from "~/education/lib/taskboard/assignees";
import { firstName } from "~/education/lib/taskboard/labels";
import type { BoardMember } from "~/education/lib/taskboard/taskboard.server";

function Pill({
  selected,
  onClick,
  children,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-[42px] items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
        selected ? "border-os-accent bg-os-accent-tint text-os-fg" : "border-os-container text-os-grey hover:bg-os-hover",
      )}
    >
      {children}
    </button>
  );
}

export function AssigneePicker({
  value,
  members,
  meId,
  onChange,
}: {
  value: string[];
  members: BoardMember[];
  meId: string;
  onChange: (ids: string[]) => void;
}) {
  const shown = pinnedMembers(members, meId, value);
  const others = orderMembers(members.filter((m) => !shown.some((s) => s.id === m.id)));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((m) => (
        <Pill key={m.id} selected={value.includes(m.id)} onClick={() => onChange(toggleAssignee(value, m.id))} label={`Assign ${m.name}`}>
          <Avatar name={m.name} photoUrl={m.photoUrl} size="compact" />
          {m.id === meId ? "Me" : firstName(m.name)}
        </Pill>
      ))}
      <Pill selected={value.length === 0} onClick={() => onChange([])} label="Assign later">
        Later
      </Pill>
      {others.length > 0 && (
        <div className="min-w-[200px] flex-1">
          <Combobox
            ariaLabel="Add another Core member"
            value=""
            onChange={(id) => id && onChange([...value, id])}
            placeholder="Add someone else"
            options={others.map((m) => ({ value: m.id, label: m.name }))}
          />
        </div>
      )}
    </div>
  );
}
