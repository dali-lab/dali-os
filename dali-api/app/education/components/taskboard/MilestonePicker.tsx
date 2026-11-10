import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Popover } from "~/components/ui/floating/Popover";
import { usePanelClass } from "~/components/ui/floating/os-styles";
import { cn } from "~/lib/cn";
import {
  createMilestoneLabel,
  milestoneLabel,
  noMatchLabel,
  searchHeader,
  searchMilestones,
  type MilestoneRef,
} from "~/education/lib/taskboard/milestone-search";
import type { BoardPeriod } from "~/education/lib/taskboard/weeks";

export function MilestonePicker({
  value,
  milestones,
  periods,
  duePeriodId,
  onChange,
  onCreate,
}: {
  value: string;
  milestones: MilestoneRef[];
  periods: BoardPeriod[];
  duePeriodId: string;
  onChange: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const selected = milestones.find((m) => m.id === value);

  return (
    <Popover
      ariaLabel="Milestone"
      panelClassName={cn(usePanelClass(), "w-[440px] max-w-[92vw] !p-0")}
      trigger={
        <button
          type="button"
          className="flex h-[42px] w-full items-center gap-2 rounded-os-field border border-os-container bg-os-bg px-3 text-left text-sm"
        >
          <Search className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-os-grey")}>
            {selected ? milestoneLabel(selected, periods, duePeriodId) : "No milestone. Search or create one"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <Panel
          milestones={milestones}
          periods={periods}
          duePeriodId={duePeriodId}
          value={value}
          onPick={(id) => {
            onChange(id);
            close();
          }}
          onCreate={(name) => {
            close();
            onCreate(name);
          }}
          onDone={close}
        />
      )}
    </Popover>
  );
}

function Panel({
  milestones,
  periods,
  duePeriodId,
  value,
  onPick,
  onCreate,
  onDone,
}: {
  milestones: MilestoneRef[];
  periods: BoardPeriod[];
  duePeriodId: string;
  value: string;
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const result = useMemo(() => searchMilestones(milestones, periods, duePeriodId, query), [milestones, periods, duePeriodId, query]);
  const dueShort = periods.find((p) => p.id === duePeriodId)?.shortName ?? "";
  const searching = query.trim() !== "";
  const row = "flex w-full items-center justify-between gap-3 rounded-os-row px-3 py-2 text-left text-sm hover:bg-os-hover";

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-os-container px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all milestones"
          aria-label="Search all milestones"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <button type="button" onClick={onDone} className="text-sm font-semibold text-os-accent">
          Done
        </button>
      </div>
      <div className="max-h-[190px] overflow-y-auto p-1.5">
        <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-os-grey">
          {searchHeader(result.mode, dueShort)}
        </p>
        {result.items.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={m.id === value}
            onClick={() => onPick(m.id)}
            className={cn(row, m.id === value && "bg-(--tb-accent-tint)")}
          >
            <span className="min-w-0 truncate font-semibold text-os-fg">{m.name}</span>
            <span className="shrink-0 text-xs text-os-grey">
              {m.periodId !== duePeriodId ? `${periods.find((p) => p.id === m.periodId)?.shortName ?? ""} · ` : ""}
              Wk {m.startWeek} to {m.endWeek}
            </span>
          </button>
        ))}
        {searching && result.items.length === 0 && <p className="px-3 py-2 text-sm text-os-grey">{noMatchLabel(query)}</p>}
        {!searching && (
          <button type="button" onClick={() => onPick("")} className={cn(row, value === "" && "bg-(--tb-accent-tint)")}>
            <span className="font-semibold text-os-fg">No milestone</span>
            <span className="text-xs text-os-grey">Loose task</span>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onCreate(query.trim())}
        className="border-t border-os-container px-4 py-3 text-left text-sm font-bold text-os-accent hover:bg-os-hover"
      >
        {createMilestoneLabel(query)}
      </button>
    </div>
  );
}
