import { useCallback, useMemo, useState } from "react";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import { Coffee, FileText, HeartHandshake } from "lucide-react";
import { Popover } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { Button } from "~/components/ui/Button";
import { CommunityColumn, type CommunityTab, type PeopleSort } from "~/members/components/CommunityColumn";
import { CommunityMap, type MapPlace } from "~/members/components/CommunityMap";
import { EventPanel } from "~/members/components/EventPanel";
import { HostEventModal } from "~/members/components/HostEventModal";
import {
  NO_PEOPLE_FILTERS,
  filterByBounds,
  filterEvents,
  filterPeople,
  groupByPlace,
  sortPeople,
  type EventFilters,
  type MapBounds,
  type PeopleFilters,
} from "~/members/lib/community";
import type { CommunityData, CommunityEvent } from "~/members/lib/community.server";
import { classmatesAt, eventsAtPlace, splitEventsByPlace } from "~/members/lib/community-view";

export type CommunityViewData = CommunityData & {
  title: string;
  tz: string;
  openTo: { coffeeChats: boolean; resumeReviews: boolean };
};

const DEFAULT_EVENT_FILTERS: Omit<EventFilters, "query"> = { host: "all", mode: "all", withinDays: 90 };

function OpenToSwitch({
  field,
  label,
  icon: Icon,
  initial,
}: {
  field: "coffeeChats" | "resumeReviews";
  label: string;
  icon: typeof Coffee;
  initial: boolean;
}) {
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("value");
  const on = pending != null ? pending === "on" : initial;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Icon className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
      <span className="flex-1 text-sm text-foreground">{label}</span>
      <Toggle
        tone="os"
        checked={on}
        aria-label={label}
        onChange={(e) =>
          fetcher.submit({ intent: "open-to", field, value: e.target.checked ? "on" : "off" }, { method: "post" })
        }
      />
    </div>
  );
}

function OpenToMenu({ openTo }: { openTo: CommunityViewData["openTo"] }) {
  return (
    <Popover
      align="right"
      ariaLabel="I'm open to"
      trigger={
        <Button variant="secondary" size="sm">
          <HeartHandshake className="h-4 w-4" aria-hidden />
          I'm open to
        </Button>
      }
      panelClassName="w-64 p-3"
    >
      <p className="mb-1 text-xs text-os-grey">Others can ask you for these. Both are off until you turn them on.</p>
      <OpenToSwitch field="coffeeChats" label="Coffee chats" icon={Coffee} initial={openTo.coffeeChats} />
      <OpenToSwitch field="resumeReviews" label="Resume reviews" icon={FileText} initial={openTo.resumeReviews} />
    </Popover>
  );
}

export function CommunityView({ data }: { data: CommunityViewData }) {
  const { viewer, people, events, filterOptions, unplaced, tz, title, openTo } = data;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<CommunityTab>("people");
  const [query, setQuery] = useState("");
  const [peopleFilters, setPeopleFilters] = useState<PeopleFilters>(NO_PEOPLE_FILTERS);
  const [eventFilters, setEventFilters] = useState(DEFAULT_EVENT_FILTERS);
  const [sort, setSort] = useState<PeopleSort>("match");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listFollowsMap, setListFollowsMap] = useState(true);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [hosting, setHosting] = useState<{ event: CommunityEvent | null } | null>(null);

  const openEventId = params.get("event");
  const openEvent = events.find((e) => e.id === openEventId) ?? null;
  const closeEvent = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("event");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);
  const openEventById = useCallback(
    (id: string) => {
      const target = events.find((e) => e.id === id);
      if (target?.href) {
        navigate(target.href);
        return;
      }
      setParams((prev) => new URLSearchParams({ ...Object.fromEntries(prev), event: id }), { replace: true });
    },
    [events, navigate, setParams],
  );

  const filteredPeople = useMemo(
    () => filterPeople(people, { ...peopleFilters, query }),
    [people, peopleFilters, query],
  );
  const allPlaces = useMemo(() => groupByPlace(people), [people]);
  const mapPlaces = useMemo<MapPlace[]>(() => {
    const matching = new Set(filteredPeople.map((p) => p.id));
    return allPlaces.map((place) => {
      const matches = place.people.filter((p) => matching.has(p.id));
      return matches.length > 0 ? { ...place, people: matches } : { ...place, faded: true };
    });
  }, [allPlaces, filteredPeople]);
  const selectedPlace = selectedKey ? (mapPlaces.find((p) => p.key === selectedKey) ?? null) : null;

  const visibleEvents = useMemo(
    () => filterEvents(events, { ...eventFilters, query }),
    [events, eventFilters, query],
  );
  const { onMap: eventsOnMap, online: eventsOnline } = useMemo(
    () => splitEventsByPlace(visibleEvents),
    [visibleEvents],
  );
  const inView = (items: CommunityEvent[]) => (listFollowsMap ? filterByBounds(items, bounds) : items);
  const eventsOnMapInView = inView(eventsOnMap);

  const sorted = useMemo(() => sortPeople(filteredPeople, sort, viewer), [filteredPeople, sort, viewer]);
  const listPeople = selectedPlace
    ? sorted.filter((p) => selectedPlace.people.some((q) => q.id === p.id))
    : listFollowsMap
      ? filterByBounds(sorted, bounds)
      : sorted;
  const nextEvent = [...eventsOnMapInView, ...eventsOnline].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;

  const clearPlace = () => setSelectedKey(null);
  const placeHead = selectedPlace
    ? {
        label: selectedPlace.label,
        peopleCount: listPeople.length,
        classmates: classmatesAt({ people: listPeople }, viewer.classYear),
      }
    : null;

  return (
    <div className="flex min-h-[480px] flex-1 flex-col lg:flex-row">
      <aside
        aria-label="Community"
        className="flex max-h-[55%] min-h-0 shrink-0 flex-col bg-os-card lg:max-h-none lg:w-[400px]"
      >
        <CommunityColumn
          title={title}
          canHost={viewer.canHost}
          onHost={() => setHosting({ event: null })}
          headerExtra={viewer.isAlumni ? <OpenToMenu openTo={openTo} /> : null}
          tab={tab}
          onTab={setTab}
          peopleCount={filteredPeople.length}
          eventsCount={visibleEvents.length}
          query={query}
          onQuery={(q) => {
            setQuery(q);
            clearPlace();
          }}
          viewer={viewer}
          tz={tz}
          filterOptions={filterOptions}
          peopleFilters={peopleFilters}
          onPeopleFilters={setPeopleFilters}
          onClearPeopleFilters={() => setPeopleFilters(NO_PEOPLE_FILTERS)}
          eventFilters={eventFilters}
          onEventFilters={setEventFilters}
          sort={sort}
          onSort={setSort}
          listFollowsMap={listFollowsMap}
          onListFollowsMap={setListFollowsMap}
          people={listPeople}
          placeHead={placeHead}
          onClearPlace={clearPlace}
          placeEvents={selectedPlace ? eventsAtPlace(eventsOnMap, selectedPlace) : []}
          nextEvent={nextEvent}
          eventsOnMap={eventsOnMapInView}
          eventsOnline={eventsOnline}
          onOpenEvent={(id) => {
            openEventById(id);
          }}
          unplaced={unplaced}
          hasLocation={viewer.hasLocation}
          toggle={
            <Toggle
              tone="os"
              label="List what's on the map"
              checked={listFollowsMap}
              onChange={(e) => setListFollowsMap(e.target.checked)}
            />
          }
        />
      </aside>

      <div className="relative min-h-[320px] flex-1">
        <div className="absolute inset-0 isolate">
          <CommunityMap
            places={mapPlaces}
            events={eventsOnMap}
            tz={tz}
            selectedKey={selectedPlace?.key ?? null}
            selectedEventId={openEvent?.id ?? null}
            onSelect={setSelectedKey}
            onSelectEvent={openEventById}
            onBoundsChange={setBounds}
            className="h-full w-full"
          />
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-full bg-os-card px-3 py-1.5 text-xs text-os-grey shadow">
          <span>People</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent-yellow" aria-hidden />
            Alumni events
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent-pink" aria-hidden />
            DALI events
          </span>
        </div>
        {openEvent && (
          <EventPanel
            key={openEvent.id}
            event={openEvent}
            tz={tz}
            onClose={closeEvent}
            onEdit={(event) => setHosting({ event })}
          />
        )}
      </div>

      {hosting && <HostEventModal open event={hosting.event} tz={tz} onClose={() => setHosting(null)} />}
    </div>
  );
}
