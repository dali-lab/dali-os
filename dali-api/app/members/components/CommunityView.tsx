import { useCallback, useMemo, useState } from "react";
import { useFetcher, useNavigate, useSearchParams } from "react-router";
import { ChevronDown, Coffee, FileText } from "lucide-react";
import { Popover } from "~/components/ui/floating";
import { FilterToggleRow, filterPanelClass } from "~/components/ui/filter-panel";
import { CommunityColumn, DEFAULT_EVENT_FILTERS, type CommunityTab, type PeopleSort } from "~/members/components/CommunityColumn";
import { CommunityMap, type MapPlace } from "~/members/components/CommunityMap";
import { EventPanel } from "~/members/components/EventPanel";
import { HostEventModal } from "~/members/components/HostEventModal";
import {
  NO_PEOPLE_FILTERS,
  filterByBounds,
  filterEvents,
  filterPeople,
  groupByPlace,
  placesLabel,
  sortPeople,
  type MapBounds,
  type PeopleFilters,
} from "~/members/lib/community";
import type { CommunityData, CommunityEvent } from "~/members/lib/community.server";
import { classmatesAt, eventsAtPlace, openToSummary, splitEventsByPlace } from "~/members/lib/community-view";

export type CommunityViewData = CommunityData & {
  tz: string;
  openTo: { coffeeChats: boolean; resumeReviews: boolean };
};

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
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
      <div className="min-w-0 flex-1">
        <FilterToggleRow
          label={label}
          checked={on}
          onChange={(checked) =>
            fetcher.submit({ intent: "open-to", field, value: checked ? "on" : "off" }, { method: "post" })
          }
        />
      </div>
    </div>
  );
}

function OpenToMenu({ openTo }: { openTo: CommunityViewData["openTo"] }) {
  return (
    <Popover
      align="right"
      ariaLabel="I'm open to"
      trigger={
        <button
          type="button"
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-os-card py-1.5 pl-1.5 pr-3 text-xs shadow"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-os-accent/15 text-os-accent">
            <Coffee className="h-3.5 w-3.5" aria-hidden />
          </span>
          <span className="font-bold text-foreground">I'm open to</span>
          <span className="text-os-grey">{openToSummary(openTo)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-os-grey" aria-hidden />
        </button>
      }
      panelClassName={filterPanelClass()}
    >
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">I'm open to</h2>
          <p className="mt-1 text-xs text-os-grey">
            Others can ask you for these from your profile. Requests stay anonymous until you say yes.
          </p>
        </div>
        <OpenToSwitch field="coffeeChats" label="Coffee chats" icon={Coffee} initial={openTo.coffeeChats} />
        <OpenToSwitch field="resumeReviews" label="Resume reviews" icon={FileText} initial={openTo.resumeReviews} />
      </div>
    </Popover>
  );
}

export function CommunityView({ data }: { data: CommunityViewData }) {
  const { viewer, people, events, filterOptions, unplaced, tz, openTo } = data;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<CommunityTab>("people");
  const [query, setQuery] = useState("");
  const [peopleFilters, setPeopleFilters] = useState<PeopleFilters>(NO_PEOPLE_FILTERS);
  const [eventFilters, setEventFilters] = useState(DEFAULT_EVENT_FILTERS);
  const [sort, setSort] = useState<PeopleSort>("match");
  const [selection, setSelection] = useState<{ keys: string[]; name: string | null } | null>(null);
  const [fitRequest, setFitRequest] = useState<{ keys: string[]; id: number } | null>(null);
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
  const selectedKeys = selection?.keys ?? null;
  const selectedPlaces = useMemo(
    () => (selectedKeys ? mapPlaces.filter((p) => selectedKeys.includes(p.key)) : []),
    [mapPlaces, selectedKeys],
  );
  const selectedPlace =
    selectedPlaces.length > 0
      ? { label: selection?.name ?? placesLabel(selectedPlaces), people: selectedPlaces.flatMap((p) => p.people) }
      : null;

  const visibleEvents = useMemo(
    () => filterEvents(events, { ...eventFilters, query }),
    [events, eventFilters, query],
  );
  const { onMap: eventsOnMap, online: eventsOnline } = useMemo(
    () => splitEventsByPlace(visibleEvents),
    [visibleEvents],
  );

  const sorted = useMemo(() => sortPeople(filteredPeople, sort, viewer), [filteredPeople, sort, viewer]);
  const listPeople = selectedPlace
    ? sorted.filter((p) => selectedPlace.people.some((q) => q.id === p.id))
    : filterByBounds(sorted, bounds);
  const placeEvents = selectedPlace ? selectedPlaces.flatMap((p) => eventsAtPlace(eventsOnMap, p)) : [];
  const listEventsOnMap = selectedPlace ? placeEvents : filterByBounds(eventsOnMap, bounds);
  const listEventsOnline = selectedPlace ? [] : eventsOnline;

  const clearPlace = () => {
    setSelection(null);
    setFitRequest((r) => ({ keys: allPlaces.map((p) => p.key), id: (r?.id ?? 0) + 1 }));
  };
  const pickPlace = (keys: string[], name: string | null) => {
    setSelection({ keys, name });
    setFitRequest((r) => ({ keys, id: (r?.id ?? 0) + 1 }));
  };
  const placeHead = selectedPlace
    ? {
        label: selectedPlace.label,
        peopleCount: listPeople.length,
        eventsCount: placeEvents.length,
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
          title="Community"
          canHost={viewer.canHost}
          onHost={() => setHosting({ event: null })}
          tab={tab}
          onTab={setTab}
          peopleCount={placeHead ? placeHead.peopleCount : filteredPeople.length}
          eventsCount={placeHead ? placeHead.eventsCount : visibleEvents.length}
          query={query}
          onQuery={setQuery}
          searchPlaces={allPlaces}
          searchPeople={people}
          onPickPlace={pickPlace}
          viewer={viewer}
          tz={tz}
          filterOptions={filterOptions}
          peopleFilters={peopleFilters}
          onPeopleFilters={setPeopleFilters}
          eventFilters={eventFilters}
          onEventFilters={setEventFilters}
          sort={sort}
          onSort={setSort}
          people={listPeople}
          placeHead={placeHead}
          onClearPlace={clearPlace}
          eventsOnMap={listEventsOnMap}
          eventsOnline={listEventsOnline}
          onOpenEvent={openEventById}
          unplaced={unplaced}
          hasLocation={viewer.hasLocation}
        />
      </aside>

      <div className="relative min-h-[320px] flex-1">
        <div className="absolute inset-0 isolate">
          <CommunityMap
            places={mapPlaces}
            events={eventsOnMap}
            tz={tz}
            home={viewer.lat != null && viewer.lng != null ? { lat: viewer.lat, lng: viewer.lng } : null}
            selectedKeys={selectedKeys}
            selectedEventId={openEvent?.id ?? null}
            onSelect={(keys) => setSelection(keys ? { keys, name: null } : null)}
            onSelectEvent={openEventById}
            onBoundsChange={setBounds}
            fitRequest={fitRequest}
            dimPeople={tab === "events"}
            className="h-full w-full"
          />
        </div>
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-3 rounded-full bg-os-card px-3 py-1.5 text-xs text-os-grey shadow">
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
        {viewer.isAlumni && (
          <div className="absolute right-3 top-3 z-10">
            <OpenToMenu openTo={openTo} />
          </div>
        )}
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
