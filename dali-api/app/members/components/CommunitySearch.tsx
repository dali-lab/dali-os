import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { autoUpdate, flip, offset, size, useDismiss, useFloating, useInteractions, FloatingPortal } from "@floating-ui/react";
import { MapPin, X } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { OS_SURFACE_CLASS } from "~/components/ui/floating/styles";
import { SearchInput } from "~/components/ui/SearchInput";
import { Z } from "~/components/ui/z";
import { cn } from "~/lib/cn";
import {
  SUGGEST_MIN_CHARS,
  suggestPeople,
  suggestPlaces,
  type CommunityPerson,
  type CommunityPlace,
} from "~/members/lib/community";
import type { CommunityTab } from "~/members/components/CommunityColumn";
import { plural } from "~/members/lib/community-view";

type Item =
  | { kind: "area"; id: string; name: string; keys: string[]; subline: string; count: number }
  | { kind: "place"; id: string; key: string; label: string; count: number }
  | { kind: "person"; id: string; person: CommunityPerson };

export type CommunitySearchProps = {
  tab: CommunityTab;
  value: string;
  onChange: (q: string) => void;
  placeName: string | null;
  onClearPlace: () => void;
  places: CommunityPlace<CommunityPerson>[];
  people: CommunityPerson[];
  onPickPlace: (keys: string[], name: string) => void;
};

function PlaceChip({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-6 min-w-0 max-w-[60%] shrink-0 items-center gap-1 rounded-[6px] bg-os-accent/15 pl-1.5 pr-1 text-xs font-semibold text-os-accent">
      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${name}`}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] hover:bg-os-accent/20"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="px-3 pb-1 pt-2 text-[11px] font-semibold text-os-muted">{children}</div>;
}

const rowClass = (active: boolean) =>
  cn(
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
    active ? "bg-os-container" : "hover:bg-os-container",
  );

export function CommunitySearch(p: CommunitySearchProps) {
  const navigate = useNavigate();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const q = p.value.trim();
  const ready = q.length >= SUGGEST_MIN_CHARS;

  const placeResult = useMemo(() => suggestPlaces(p.places, q), [p.places, q]);
  const personResult = useMemo(() => (p.tab === "people" ? suggestPeople(p.people, q) : []), [p.tab, p.people, q]);
  const items = useMemo<Item[]>(
    () => [
      ...(placeResult.area ? [{ kind: "area" as const, id: "area", ...placeResult.area }] : []),
      ...placeResult.places.map((x) => ({ kind: "place" as const, id: x.key, key: x.key, label: x.label, count: x.count })),
      ...personResult.map((person) => ({ kind: "person" as const, id: person.id, person })),
    ],
    [placeResult, personResult],
  );
  const shown = open && ready;

  const { refs, floatingStyles, context } = useFloating({
    open: shown,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      size({
        padding: 8,
        apply({ rects, elements, availableHeight }) {
          Object.assign(elements.floating.style, {
            width: `${rects.reference.width}px`,
            maxHeight: `${Math.min(availableHeight, 420)}px`,
          });
        },
      }),
    ],
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

  function pick(item: Item) {
    setOpen(false);
    setActive(null);
    if (item.kind === "person") {
      navigate(`/members/${item.person.id}`);
      return;
    }
    p.onChange("");
    if (item.kind === "area") p.onPickPlace(item.keys, item.name);
    else p.onPickPlace([item.key], item.label);
  }

  const peopleTab = p.tab === "people";
  const placeholder = p.placeName
    ? peopleTab
      ? "Name or company"
      : "Event or host"
    : peopleTab
      ? "Name, company, or city"
      : "Event, host, or city";
  const sectionOf = (i: Item) => (i.kind === "person" ? "People" : "Places");

  return (
    <div ref={refs.setReference} {...getReferenceProps()}>
      <SearchInput
        value={p.value}
        onChange={(e) => {
          p.onChange(e.target.value);
          setOpen(true);
          setActive(null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && shown) {
            e.preventDefault();
            setOpen(false);
            return;
          }
          if (!shown || items.length === 0) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i === null ? (step === 1 ? 0 : items.length - 1) : (i + step + items.length) % items.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (active !== null) pick(items[active]);
            else setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label={peopleTab ? "Search people" : "Search events"}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active !== null ? `${listId}-${active}` : undefined}
        leading={p.placeName ? <PlaceChip name={p.placeName} onClear={p.onClearPlace} /> : undefined}
      />
      {shown && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(Z.popover, OS_SURFACE_CLASS, "overflow-y-auto p-1.5")}
            {...getFloatingProps()}
          >
            <div id={listId} role="listbox" aria-label="Suggestions">
              {items.map((item, i) => (
                <div key={`${item.kind}-${item.id}`}>
                  {(i === 0 || sectionOf(items[i - 1]) !== sectionOf(item)) && <SectionLabel>{sectionOf(item)}</SectionLabel>}
                  <button
                    type="button"
                    role="option"
                    id={`${listId}-${i}`}
                    aria-selected={i === active}
                    onClick={() => pick(item)}
                    onMouseMove={() => setActive(i)}
                    className={rowClass(i === active)}
                  >
                    {item.kind === "person" ? (
                      <>
                        <Avatar photoUrl={item.person.photoUrl} name={item.person.name} size="sm" userId={item.person.id} className="shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">{item.person.name}</span>
                          <span className="block truncate text-xs text-os-grey">
                            {[item.person.currentJob, item.person.location].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <MapPin className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {item.kind === "area" ? `${item.name} area` : item.label}
                          </span>
                          {item.kind === "area" && <span className="block truncate text-xs text-os-grey">{item.subline}</span>}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-os-muted">
                          {plural(item.count, "person", "people")}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
            <p className="px-3 py-2 text-xs text-os-muted">
              Press Enter to search names, jobs and cities for "{q}"
            </p>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
