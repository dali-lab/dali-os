import type { ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { Coffee, Plus } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { LoadMore } from "~/components/ui/Pager";
import { Segmented } from "~/components/ui/Segmented";
import {
  FilterGroup,
  FilterPill,
  FilterToggleRow,
  FiltersPopover,
} from "~/components/ui/filter-panel";
import { Select } from "~/components/ui/floating";
import { useClientSlice } from "~/hooks/useClientSlice";
import { cn } from "~/lib/cn";
import { CommunitySearch } from "~/members/components/CommunitySearch";
import {
  DEFAULT_EVENT_WINDOW_DAYS,
  NO_PEOPLE_FILTERS,
  countEventFilters,
  countPeopleFilters,
  whyLine,
  type CommunityPerson,
  type CommunityPlace,
  type CommunityViewer,
  type EventFilters,
  type PeopleFilters,
} from "~/members/lib/community";
import type { CommunityEvent, CommunityFilterOptions } from "~/members/lib/community.server";
import {
  eventDateBlock,
  eventWhenShort,
  goingText,
  peopleCountLabel,
  placeSummary,
  shortYear,
} from "~/members/lib/community-view";

export type CommunityTab = "people" | "events";
export type PeopleSort = "match" | "name";
export type PlaceHead = { label: string; peopleCount: number; eventsCount: number; classmates: number };

export const DEFAULT_EVENT_FILTERS: Omit<EventFilters, "query"> = {
  host: "all",
  mode: "all",
  withinDays: DEFAULT_EVENT_WINDOW_DAYS,
};

const WHO_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "alumni", label: "Alumni" },
  { value: "students", label: "Students" },
] as const;

const OPEN_TO_OPTIONS = [
  { value: "coffee", label: "Coffee chats" },
  { value: "resume", label: "Resume reviews" },
] as const;

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

const toggled = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function PeopleFilterPanel({
  filters,
  onChange,
  options,
}: {
  filters: PeopleFilters;
  onChange: (next: PeopleFilters) => void;
  options: CommunityFilterOptions;
}) {
  const set = (patch: Partial<PeopleFilters>) => onChange({ ...filters, ...patch });
  return (
    <>
      <FilterGroup label="Who">
        {WHO_OPTIONS.map((o) => (
          <FilterPill key={o.value} selected={filters.who === o.value} onClick={() => set({ who: o.value })}>
            {o.label}
          </FilterPill>
        ))}
      </FilterGroup>
      {options.classYears.length > 0 && (
        <FilterGroup label="Class">
          {options.classYears.map((c) => (
            <FilterPill
              key={c.value}
              selected={filters.classYears.includes(c.value)}
              onClick={() => set({ classYears: toggled(filters.classYears, c.value) })}
            >
              {c.value}
            </FilterPill>
          ))}
        </FilterGroup>
      )}
      {options.roles.length > 0 && (
        <FilterGroup label="Role at DALI">
          {options.roles.map((r) => (
            <FilterPill
              key={r.value}
              selected={filters.roles.includes(r.value)}
              onClick={() => set({ roles: toggled(filters.roles, r.value) })}
            >
              {r.value}
            </FilterPill>
          ))}
        </FilterGroup>
      )}
      {options.projects.length > 0 && (
        <FilterGroup label="Project">
          {options.projects.map((pr) => (
            <FilterPill
              key={pr.id}
              selected={filters.projectIds.includes(pr.id)}
              onClick={() => set({ projectIds: toggled(filters.projectIds, pr.id) })}
            >
              {pr.name}, {pr.term}
            </FilterPill>
          ))}
        </FilterGroup>
      )}
      <FilterGroup label="Open to">
        {OPEN_TO_OPTIONS.map((o) => (
          <FilterPill
            key={o.value}
            selected={filters.openTo.includes(o.value)}
            onClick={() => set({ openTo: toggled(filters.openTo, o.value) })}
          >
            {o.label}
          </FilterPill>
        ))}
      </FilterGroup>
      <FilterToggleRow
        label="Active this week"
        checked={filters.activeThisWeek}
        onChange={(activeThisWeek) => set({ activeThisWeek })}
      />
    </>
  );
}

type EventFilterValues = Omit<EventFilters, "query">;

function EventFilterPanel({
  filters,
  onChange,
}: {
  filters: EventFilterValues;
  onChange: (next: EventFilterValues) => void;
}) {
  const windowValue = filters.withinDays == null ? "any" : String(filters.withinDays);
  return (
    <>
      <FilterGroup label="Date window">
        {WINDOW_OPTIONS.map((o) => (
          <FilterPill
            key={o.value}
            selected={windowValue === o.value}
            onClick={() => onChange({ ...filters, withinDays: o.value === "any" ? null : Number(o.value) })}
          >
            {o.label}
          </FilterPill>
        ))}
      </FilterGroup>
      <FilterGroup label="Hosted by">
        {HOST_OPTIONS.map((o) => (
          <FilterPill key={o.value} selected={filters.host === o.value} onClick={() => onChange({ ...filters, host: o.value })}>
            {o.label}
          </FilterPill>
        ))}
      </FilterGroup>
      <FilterGroup label="Where">
        {MODE_OPTIONS.map((o) => (
          <FilterPill key={o.value} selected={filters.mode === o.value} onClick={() => onChange({ ...filters, mode: o.value })}>
            {o.label}
          </FilterPill>
        ))}
      </FilterGroup>
    </>
  );
}

function ActivityMarker({ activity }: { activity: CommunityPerson["activity"] }) {
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

export function PersonRow({ person, viewer }: { person: CommunityPerson; viewer: CommunityViewer }) {
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

function DateBlock({ startsAt, tz, source }: { startsAt: string; tz: string; source: CommunityEvent["source"] }) {
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

function RsvpButton({ event }: { event: CommunityEvent }) {
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
  event: CommunityEvent;
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

function HostRow({ onHost }: { onHost: () => void }) {
  return (
    <button
      type="button"
      onClick={onHost}
      className="flex items-center gap-3 rounded-os-card border border-dashed border-os-container px-3 py-3 text-left transition-colors hover:bg-os-container"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-os-item bg-accent-yellow/30 text-os-accent">
        <Plus className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">Host an event</span>
        <span className="block text-xs text-os-grey">Drinks, a talk, a study night. It goes on the map.</span>
      </span>
    </button>
  );
}

export type CommunityColumnProps = {
  title: string;
  canHost: boolean;
  onHost: () => void;
  tab: CommunityTab;
  onTab: (tab: CommunityTab) => void;
  peopleCount: number;
  eventsCount: number;
  query: string;
  onQuery: (q: string) => void;
  searchPlaces: CommunityPlace<CommunityPerson>[];
  searchPeople: CommunityPerson[];
  onPickPlace: (keys: string[], name: string) => void;
  viewer: CommunityViewer;
  tz: string;
  filterOptions: CommunityFilterOptions;
  peopleFilters: PeopleFilters;
  onPeopleFilters: (f: PeopleFilters) => void;
  eventFilters: EventFilterValues;
  onEventFilters: (f: EventFilterValues) => void;
  sort: PeopleSort;
  onSort: (s: PeopleSort) => void;
  people: CommunityPerson[];
  placeHead: PlaceHead | null;
  onClearPlace: () => void;
  eventsOnMap: CommunityEvent[];
  eventsOnline: CommunityEvent[];
  onOpenEvent: (id: string) => void;
  unplaced: number;
  hasLocation: boolean;
};

export function CommunityColumn(p: CommunityColumnProps) {
  const { visible, pager } = useClientSlice(p.people, {
    resetKey: JSON.stringify([p.query, p.peopleFilters, p.sort, p.placeHead?.label ?? null]),
  });
  const peopleTab = p.tab === "people";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <header>
        <h1 className="font-heading text-2xl font-medium text-foreground">{p.title}</h1>
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

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <CommunitySearch
            tab={p.tab}
            value={p.query}
            onChange={p.onQuery}
            placeName={p.placeHead?.label ?? null}
            onClearPlace={p.onClearPlace}
            places={p.searchPlaces}
            people={p.searchPeople}
            onPickPlace={p.onPickPlace}
          />
        </div>
        {peopleTab ? (
          <FiltersPopover count={countPeopleFilters(p.peopleFilters)} onReset={() => p.onPeopleFilters(NO_PEOPLE_FILTERS)}>
            <PeopleFilterPanel filters={p.peopleFilters} onChange={p.onPeopleFilters} options={p.filterOptions} />
          </FiltersPopover>
        ) : (
          <FiltersPopover count={countEventFilters(p.eventFilters)} onReset={() => p.onEventFilters(DEFAULT_EVENT_FILTERS)}>
            <EventFilterPanel filters={p.eventFilters} onChange={p.onEventFilters} />
          </FiltersPopover>
        )}
      </div>

      {p.placeHead && (
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">{p.placeHead.label}</h2>
          <p className="text-xs text-os-grey">
            {placeSummary(p.tab, {
              people: p.placeHead.peopleCount,
              events: p.placeHead.eventsCount,
              classmates: p.placeHead.classmates,
            })}
          </p>
        </div>
      )}

      {peopleTab ? (
        <>
          {!p.placeHead && (
            <div className="flex items-center justify-between gap-2 text-xs text-os-grey">
              <span>{peopleCountLabel(p.people.length, null)}</span>
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
          {p.canHost && <HostRow onHost={p.onHost} />}
          {p.eventsOnMap.length === 0 && p.eventsOnline.length === 0 ? (
            <p className="py-6 text-center text-sm text-os-muted">No upcoming events.</p>
          ) : (
            <>
              {p.eventsOnMap.length > 0 &&
                (p.placeHead ? (
                  <div>
                    {p.eventsOnMap.map((e) => (
                      <EventRow key={e.id} event={e} tz={p.tz} onOpen={p.onOpenEvent} />
                    ))}
                  </div>
                ) : (
                  <Group title={`${p.eventsOnMap.length} in this view`}>
                    {p.eventsOnMap.map((e) => (
                      <EventRow key={e.id} event={e} tz={p.tz} onOpen={p.onOpenEvent} />
                    ))}
                  </Group>
                ))}
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
