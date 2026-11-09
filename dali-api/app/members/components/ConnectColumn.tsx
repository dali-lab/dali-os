import type { ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { ArrowLeft, CalendarDays, ChevronDown, Coffee, Plus } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { LoadMore } from "~/components/ui/Pager";
import { SearchInput } from "~/components/ui/SearchInput";
import { Segmented } from "~/components/ui/Segmented";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { InfoTip, MultiSelect, Select } from "~/components/ui/floating";
import { useClientSlice } from "~/hooks/useClientSlice";
import { cn } from "~/lib/cn";
import {
  hasPeopleFilters,
  whyLine,
  type ConnectPerson,
  type ConnectViewer,
  type EventFilters,
  type PeopleFilters,
} from "~/members/lib/connect";
import type { ConnectEvent, ConnectFilterOptions } from "~/members/lib/connect.server";
import {
  eventDateBlock,
  eventWhenShort,
  goingText,
  plural,
  shortYear,
} from "~/members/lib/connect-view";

export type ConnectTab = "people" | "events";
export type PeopleSort = "match" | "name";
export type PlaceHead = { label: string; peopleCount: number; classmates: number };

const CHIP_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs text-foreground transition-colors hover:bg-muted/40";
const chipClass = (active: boolean) => cn(CHIP_CLASS, active ? "border-os-accent text-os-accent" : "border-border");

function ChipMulti({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: { value: string; label: string; count: number }[];
  onChange: (next: string[]) => void;
}) {
  return (
    <MultiSelect
      values={values}
      options={options.map((o) => ({
        value: o.value,
        label: o.label,
        trailing: <span className="text-xs tabular-nums text-os-muted">{o.count}</span>,
      }))}
      onChange={onChange}
      ariaLabel={label}
      chips={false}
      clearLabel="Clear"
      buttonClassName={chipClass(values.length > 0)}
      renderTrigger={({ chosen }) => (
        <>
          <span>{chosen.length > 0 ? `${label} · ${chosen.length}` : label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </>
      )}
    />
  );
}

const WHO_OPTIONS = [
  { value: "all", label: "Alumni and students" },
  { value: "alumni", label: "Alumni" },
  { value: "students", label: "Students" },
] as const;

const OPEN_TO_OPTIONS = [
  { value: "coffee", label: "Coffee chats" },
  { value: "resume", label: "Resume reviews" },
];

function PeopleFilterChips({
  filters,
  onChange,
  options,
  onClear,
}: {
  filters: PeopleFilters;
  onChange: (next: PeopleFilters) => void;
  options: ConnectFilterOptions;
  onClear: () => void;
}) {
  const set = (patch: Partial<PeopleFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={filters.who}
        onChange={(who) => set({ who })}
        options={WHO_OPTIONS.map((o) => ({ ...o }))}
        ariaLabel="Who"
        buttonClassName={chipClass(filters.who !== "all")}
      />
      <ChipMulti
        label="Class"
        values={filters.classYears.map(String)}
        options={options.classYears.map((c) => ({ value: String(c.value), label: String(c.value), count: c.count }))}
        onChange={(next) => set({ classYears: next.map(Number) })}
      />
      <span className="inline-flex items-center gap-1">
        <ChipMulti
          label="Role at DALI"
          values={filters.roles}
          options={options.roles.map((r) => ({ value: r.value, label: r.value, count: r.count }))}
          onChange={(roles) => set({ roles })}
        />
        <InfoTip content="From their DALI terms" label="About role at DALI" />
      </span>
      <ChipMulti
        label="Project"
        values={filters.projectIds}
        options={options.projects.map((p) => ({ value: p.id, label: `${p.name}, ${p.term}`, count: p.count }))}
        onChange={(projectIds) => set({ projectIds })}
      />
      <MultiSelect
        values={filters.openTo}
        options={OPEN_TO_OPTIONS}
        onChange={(openTo) => set({ openTo: openTo as PeopleFilters["openTo"] })}
        ariaLabel="Open to"
        chips={false}
        buttonClassName={chipClass(filters.openTo.length > 0)}
        renderTrigger={({ chosen }) => (
          <>
            <span>{chosen.length > 0 ? `Open to · ${chosen.length}` : "Open to"}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
          </>
        )}
      />
      <ToggleChip on={filters.activeThisWeek} onToggle={() => set({ activeThisWeek: !filters.activeThisWeek })}>
        Active this week
      </ToggleChip>
      {hasPeopleFilters(filters) && (
        <button type="button" onClick={onClear} className="text-xs text-os-accent underline-offset-2 hover:underline">
          Clear
        </button>
      )}
    </div>
  );
}

const WINDOW_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "7", label: "Next 7 days" },
  { value: "30", label: "Next 30 days" },
  { value: "90", label: "Next 3 months" },
];
const HOST_OPTIONS = [
  { value: "all", label: "Alumni and DALI" },
  { value: "alumni", label: "Alumni events" },
  { value: "dali", label: "DALI events" },
] as const;
const MODE_OPTIONS = [
  { value: "all", label: "In person and online" },
  { value: "inPerson", label: "In person" },
  { value: "online", label: "Online" },
] as const;

function EventFilterChips({
  filters,
  onChange,
}: {
  filters: Omit<EventFilters, "query">;
  onChange: (next: Omit<EventFilters, "query">) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={filters.withinDays == null ? "any" : String(filters.withinDays)}
        onChange={(v) => onChange({ ...filters, withinDays: v === "any" ? null : Number(v) })}
        options={WINDOW_OPTIONS}
        ariaLabel="Date window"
        buttonClassName={chipClass(filters.withinDays !== 90)}
      />
      <Select
        value={filters.host}
        onChange={(host) => onChange({ ...filters, host })}
        options={HOST_OPTIONS.map((o) => ({ ...o }))}
        ariaLabel="Hosted by"
        buttonClassName={chipClass(filters.host !== "all")}
      />
      <Select
        value={filters.mode}
        onChange={(mode) => onChange({ ...filters, mode })}
        options={MODE_OPTIONS.map((o) => ({ ...o }))}
        ariaLabel="In person or online"
        buttonClassName={chipClass(filters.mode !== "all")}
      />
    </div>
  );
}

function ActivityMarker({ activity }: { activity: ConnectPerson["activity"] }) {
  if (!activity) return null;
  const today = activity === "today";
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-os-grey">
      <span
        aria-hidden
        data-activity={activity}
        className={cn("h-2 w-2 rounded-full border border-os-green", today && "bg-os-green")}
      />
      {today ? "Active today" : "This week"}
    </span>
  );
}

export function PersonRow({ person, viewer }: { person: ConnectPerson; viewer: ConnectViewer }) {
  const why = whyLine(person, viewer);
  const sub = [person.currentJob, person.location].filter(Boolean).join(" · ");
  const year = shortYear(person.classYear);
  return (
    <Link
      to={`/members/${person.id}`}
      className="flex items-start gap-2.5 rounded-os-item px-2 py-2 transition-colors hover:bg-os-container"
    >
      <Avatar photoUrl={person.photoUrl} name={person.name} size="sm" userId={person.id} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm text-foreground">
            {person.name}
            {year && <span className="text-os-grey"> {year}</span>}
          </span>
          {person.isStudent && (
            <span className="shrink-0 rounded-md bg-os-container px-1.5 py-0.5 text-[10px] font-semibold text-os-grey">
              Student
            </span>
          )}
          {person.openToCoffeeChats && (
            <Coffee className="h-3.5 w-3.5 shrink-0 text-os-grey" aria-label="Open to coffee chats" />
          )}
          <ActivityMarker activity={person.activity} />
        </span>
        <span className="block truncate text-xs text-os-grey">{sub}</span>
        {why && <span className="block truncate text-xs text-os-accent">{why}</span>}
      </span>
    </Link>
  );
}

function DateBlock({ startsAt, tz, source }: { startsAt: string; tz: string; source: ConnectEvent["source"] }) {
  const { month, day } = eventDateBlock(startsAt, tz);
  return (
    <span
      className={cn(
        "flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-os-item text-navy-deep",
        source === "dali" ? "bg-accent-pink" : "bg-accent-yellow",
      )}
    >
      <span className="text-[10px] font-bold leading-none">{month}</span>
      <span className="mt-0.5 text-lg font-bold leading-none">{day}</span>
    </span>
  );
}

export { DateBlock };

function RsvpButton({ event }: { event: ConnectEvent }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("going");
  const going = pending != null ? pending === "true" : event.viewerGoing;
  return (
    <fetcher.Form method="post" onClick={(e) => e.stopPropagation()}>
      <input type="hidden" name="intent" value="rsvp" />
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="going" value={String(!going)} />
      <Button type="submit" size="sm" variant={going ? "secondary" : "primary"}>
        {going ? "Going" : "RSVP"}
      </Button>
    </fetcher.Form>
  );
}

export function EventRow({
  event,
  tz,
  onOpen,
}: {
  event: ConnectEvent;
  tz: string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-os-item px-2 py-2 transition-colors hover:bg-os-container">
      <button type="button" onClick={() => onOpen(event.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <DateBlock startsAt={event.startsAt} tz={tz} source={event.source} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{event.title}</span>
          <span className="block truncate text-xs text-os-grey">{eventWhenShort(event, tz)}</span>
          <span className="mt-1 flex items-center gap-1.5 text-xs text-os-muted">
            {event.attendees.length > 0 && (
              <span className="flex -space-x-1.5">
                {event.attendees.slice(0, 3).map((a) => (
                  <Avatar key={a.id} photoUrl={a.photoUrl} name={a.name} size="xs" className="ring-2 ring-os-card" />
                ))}
              </span>
            )}
            {event.source === "alumni" && <span>{goingText(event)}</span>}
          </span>
        </span>
      </button>
      {event.source === "alumni" && <RsvpButton event={event} />}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="py-1.5 text-xs font-semibold text-os-grey">{title}</h3>
      {children}
    </section>
  );
}

export type ConnectColumnProps = {
  title: string;
  canHost: boolean;
  onHost: () => void;
  headerExtra?: ReactNode;
  tab: ConnectTab;
  onTab: (tab: ConnectTab) => void;
  peopleCount: number;
  eventsCount: number;
  query: string;
  onQuery: (q: string) => void;
  viewer: ConnectViewer;
  tz: string;
  filterOptions: ConnectFilterOptions;
  peopleFilters: PeopleFilters;
  onPeopleFilters: (f: PeopleFilters) => void;
  onClearPeopleFilters: () => void;
  eventFilters: Omit<EventFilters, "query">;
  onEventFilters: (f: Omit<EventFilters, "query">) => void;
  sort: PeopleSort;
  onSort: (s: PeopleSort) => void;
  listFollowsMap: boolean;
  onListFollowsMap: (on: boolean) => void;
  people: ConnectPerson[];
  placeHead: PlaceHead | null;
  onClearPlace: () => void;
  placeEvents: ConnectEvent[];
  nextEvent: ConnectEvent | null;
  eventsOnMap: ConnectEvent[];
  eventsOnline: ConnectEvent[];
  onOpenEvent: (id: string) => void;
  unplaced: number;
  hasLocation: boolean;
  toggle: ReactNode;
};

export function ConnectColumn(p: ConnectColumnProps) {
  const { visible, pager } = useClientSlice(p.people, {
    resetKey: JSON.stringify([p.query, p.peopleFilters, p.sort, p.placeHead?.label ?? null, p.listFollowsMap]),
  });
  const countLabel = p.listFollowsMap && !p.placeHead ? `${p.people.length} on the map` : plural(p.people.length, "person", "people");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-medium text-foreground">{p.title}</h1>
        <div className="flex items-center gap-2">
          {p.headerExtra}
          {p.canHost && (
            <Button size="sm" onClick={p.onHost}>
              <Plus className="h-4 w-4" aria-hidden />
              Host an event
            </Button>
          )}
        </div>
      </header>

      <Segmented
        value={p.tab}
        onChange={p.onTab}
        options={[
          { value: "people", label: "People", count: p.peopleCount },
          { value: "events", label: "Events", count: p.eventsCount },
        ]}
        ariaLabel="Show"
        fullWidth
        size="md"
        className="shrink-0"
      />

      <SearchInput
        value={p.query}
        onChange={(e) => p.onQuery(e.target.value)}
        placeholder={p.tab === "people" ? "Name, company, or city" : "Event, host, or city"}
        aria-label={p.tab === "people" ? "Search people" : "Search events"}
      />

      {p.tab === "people" ? (
        <>
          <PeopleFilterChips
            filters={p.peopleFilters}
            onChange={p.onPeopleFilters}
            options={p.filterOptions}
            onClear={p.onClearPeopleFilters}
          />
          {p.toggle}
          {p.nextEvent && !p.placeHead && (
            <button
              type="button"
              onClick={() => p.onOpenEvent(p.nextEvent!.id)}
              className="flex items-center gap-2 rounded-os-item bg-os-container px-3 py-2 text-left text-xs text-os-grey hover:bg-os-hover"
            >
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">
                <span className="font-semibold text-foreground">Next event</span> · {p.nextEvent.title} ·{" "}
                {eventWhenShort(p.nextEvent, p.tz)}
              </span>
            </button>
          )}
          {p.placeHead ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={p.onClearPlace}
                className="inline-flex items-center gap-1 self-start text-xs text-os-accent hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                All places
              </button>
              <h2 className="text-base font-semibold text-foreground">{p.placeHead.label}</h2>
              <p className="text-xs text-os-grey">
                {plural(p.placeHead.peopleCount, "person", "people")}, {p.placeHead.classmates} from your class
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-xs text-os-grey">
              <span>{countLabel}</span>
              <Select
                value={p.sort}
                onChange={p.onSort}
                options={[
                  { value: "match", label: "Best match" },
                  { value: "name", label: "Name" },
                ]}
                ariaLabel="Sort"
              />
            </div>
          )}
          {p.placeEvents.length > 0 && (
            <Group title="Events here">
              {p.placeEvents.map((e) => (
                <EventRow key={e.id} event={e} tz={p.tz} onOpen={p.onOpenEvent} />
              ))}
            </Group>
          )}
          <div>
            {p.people.length === 0 ? (
              <p className="py-6 text-center text-sm text-os-muted">No one matches.</p>
            ) : (
              visible.map((person) => <PersonRow key={person.id} person={person} viewer={p.viewer} />)
            )}
            <LoadMore {...pager} />
          </div>
          {p.unplaced > 0 && (
            <p className="text-xs text-os-muted">
              {p.unplaced} more {p.unplaced === 1 ? "alum has" : "alumni have"} no location yet.
            </p>
          )}
          {!p.hasLocation && (
            <Link to="/profile" className="text-sm text-os-grey underline-offset-4 hover:text-foreground hover:underline">
              Add where you're based
            </Link>
          )}
        </>
      ) : (
        <>
          <EventFilterChips filters={p.eventFilters} onChange={p.onEventFilters} />
          {p.toggle}
          {p.eventsOnMap.length === 0 && p.eventsOnline.length === 0 ? (
            <p className="py-6 text-center text-sm text-os-muted">No upcoming events.</p>
          ) : (
            <>
              {p.eventsOnMap.length > 0 && (
                <Group title={`${p.eventsOnMap.length} on the map`}>
                  {p.eventsOnMap.map((e) => (
                    <EventRow key={e.id} event={e} tz={p.tz} onOpen={p.onOpenEvent} />
                  ))}
                </Group>
              )}
              {p.eventsOnline.length > 0 && (
                <Group title="Online">
                  {p.eventsOnline.map((e) => (
                    <EventRow key={e.id} event={e} tz={p.tz} onOpen={p.onOpenEvent} />
                  ))}
                </Group>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
