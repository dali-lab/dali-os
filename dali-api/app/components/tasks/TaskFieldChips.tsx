import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Avatar } from "~/components/ui/Avatar";
import { DateField } from "~/components/ui/DateField";
import { Combobox, Select, type SelectOption } from "~/components/ui/floating";
import { isSearchableQuery, useLabMemberSearch } from "~/components/meeting-recorder/member-search";
import { DUR, POP_FRAMES, animate } from "~/components/meeting-recorder/motion";
import { TaskStatusDot } from "~/components/doc/schema/TaskMentionHoverCard";
import { cn } from "~/lib/cn";
import { TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from "~/projects/lib/task-board";

export const TASK_CHIP_BASE = "h-7 rounded-full border px-2.5 text-xs font-medium";
export const TASK_CHIP_CLASS = cn(TASK_CHIP_BASE, "border-border bg-card text-foreground");
export const TASK_CHIP_REQUIRED_CLASS = cn(TASK_CHIP_BASE, "border-dashed border-os-amber/60 bg-os-amber/10 text-foreground");

type RosterPerson = { userId: string; name: string };

export function TaskOwnerChip({
  value,
  name,
  roster,
  rosterLabel,
  onChange,
  ariaLabel,
  placeholder = "Add owner",
  className,
}: {
  value: string;
  name: string;
  roster: RosterPerson[];
  /** The roster's section name, such as "In this meeting". */
  rosterLabel: string;
  onChange: (userId: string, name: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const swap = useRef<HTMLDivElement>(null);
  const lastOwner = useRef(value);
  useEffect(() => {
    if (lastOwner.current === value) return;
    lastOwner.current = value;
    void animate(swap.current, POP_FRAMES(0.92), DUR.ownerIn);
  }, [value]);
  const { setQuery, query, results } = useLabMemberSearch();

  const options = useMemo<SelectOption[]>(() => {
    const listed: SelectOption[] = roster.map((r) => ({ value: r.userId, label: r.name, description: rosterLabel }));
    const found: SelectOption[] = results
      .filter((m) => !roster.some((r) => r.userId === m.id))
      .map((m) => ({ value: m.id, label: m.name, description: "Lab member" }));
    const known = [...listed, ...found];
    if (value && !known.some((o) => o.value === value)) {
      known.push({ value, label: name || "Assigned" });
    }
    return known;
  }, [roster, rosterLabel, results, value, name]);

  const selectedName = options.find((o) => o.value === value)?.label;

  return (
    <div ref={swap}>
      <Combobox
        value={value}
        options={options}
        onChange={(next) => onChange(next, options.find((o) => o.value === next)?.label ?? "")}
        onQueryChange={setQuery}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        emptyLabel={isSearchableQuery(query) ? "No matches" : "Type to search lab members"}
        icon={selectedName ? <Avatar name={selectedName} size="xs" /> : undefined}
        className={className ?? cn("w-48", TASK_CHIP_CLASS)}
      />
    </div>
  );
}

export function TaskDueChip({
  value,
  onChange,
  ariaLabel,
  className = "w-36",
  buttonClassName = cn(TASK_CHIP_CLASS, "justify-between"),
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  buttonClassName?: string;
}) {
  return (
    <div className={className}>
      <DateField mode="date" value={value} onChange={onChange} placeholder="Add date" ariaLabel={ariaLabel} buttonClassName={buttonClassName} />
    </div>
  );
}

const STATUS_OPTIONS: SelectOption<TaskStatus>[] = TASK_STATUSES.map((status) => ({
  value: status,
  label: TASK_STATUS_LABELS[status],
  icon: <TaskStatusDot status={status} className="h-2 w-2" />,
}));

export function TaskStatusChip({
  value,
  onChange,
  ariaLabel,
  className = TASK_CHIP_CLASS,
}: {
  value: TaskStatus;
  onChange: (status: TaskStatus) => void;
  ariaLabel: string;
  className?: string;
}) {
  const icon: ReactNode = <TaskStatusDot status={value} className="h-2 w-2" />;
  return (
    <Select<TaskStatus>
      value={value}
      options={STATUS_OPTIONS}
      onChange={onChange}
      ariaLabel={ariaLabel}
      triggerIcon={icon}
      insideEditor
      buttonClassName={className}
    />
  );
}
