import { useEffect, useRef, useState, type ReactNode } from "react";
import { MapPin, Plus, X } from "lucide-react";
import { Combobox, type SelectOption } from "~/components/ui/floating";
import { IconButton } from "~/components/ui/IconButton";

type Place = { geonameId: number; name: string; region: string; country: string; label: string };

const FREE_PREFIX = "free:";
const CITY_PREFIX = "city:";
const DEBOUNCE_MS = 200;

export type BasedInValue = {
  currentLocation: string | null;
  currentLocationGeonameId: number | null;
  currentLocationLat: number | null;
  currentLocationCity: string | null;
  currentLocationRegion: string | null;
  currentLocationCountry: string | null;
};

export function structuredPlace(v: BasedInValue): string | null {
  const parts = [v.currentLocationCity, v.currentLocationRegion].filter(Boolean);
  return parts.length ? parts.join(", ") : v.currentLocation;
}

export function BasedInFeedback({ value }: { value: BasedInValue }) {
  if (!value.currentLocation || value.currentLocationGeonameId != null) return null;
  if (value.currentLocationLat == null) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-os-amber">
        <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Not found on the map. Try a city and country.
      </p>
    );
  }
  const as =
    [value.currentLocationCity, value.currentLocationRegion, value.currentLocationCountry]
      .filter(Boolean)
      .join(", ") || value.currentLocation;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-os-accent" aria-hidden />
      <span>
        On the map as <strong className="font-semibold text-foreground">{as}</strong>
      </span>
    </p>
  );
}

function BoldPrefix({ text, query }: { text: string; query: string }) {
  const n = text.toLowerCase().startsWith(query.toLowerCase()) ? query.length : 0;
  return (
    <>
      <span className="font-semibold">{text.slice(0, n)}</span>
      <span className="font-normal">{text.slice(n)}</span>
    </>
  );
}

export function BasedInField({ value }: { value: BasedInValue }) {
  const [text, setText] = useState(value.currentLocation ?? "");
  const [geonameId, setGeonameId] = useState(value.currentLocationGeonameId?.toString() ?? "");
  const [places, setPlaces] = useState<Place[]>([]);
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );

  function search(next: string) {
    setQuery(next);
    if (timer.current) clearTimeout(timer.current);
    controller.current?.abort();
    const q = next.trim();
    if (q.length < 2) {
      setPlaces([]);
      return;
    }
    timer.current = setTimeout(async () => {
      const ctl = new AbortController();
      controller.current = ctl;
      try {
        const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}`, {
          signal: ctl.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { places: Place[] };
        setPlaces(body.places);
      } catch {
        // an aborted or failed lookup leaves the last results in place
      }
    }, DEBOUNCE_MS);
  }

  const options: SelectOption<string>[] = places.map((p) => ({
    value: `${CITY_PREFIX}${p.geonameId}`,
    label: p.name,
    description: [p.region, p.country].filter(Boolean).join(", "),
    icon: <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />,
  }));

  function choose(v: string) {
    if (v.startsWith(FREE_PREFIX)) {
      setText(v.slice(FREE_PREFIX.length));
      setGeonameId("");
      return;
    }
    const picked = places.find((p) => `${CITY_PREFIX}${p.geonameId}` === v);
    if (picked) {
      setText(picked.label);
      setGeonameId(String(picked.geonameId));
    }
  }

  const renderLabel = (o: SelectOption<string>, q: string): ReactNode =>
    o.value.startsWith(FREE_PREFIX) ? o.label : <BoldPrefix text={o.label} query={q} />;

  return (
    <div>
      <input type="hidden" name="currentLocation" value={text} />
      <input type="hidden" name="currentLocationGeonameId" value={geonameId} />
      <div className="flex items-center gap-1">
        <Combobox
          value=""
          options={options}
          onChange={choose}
          filterLocally={false}
          onQueryChange={search}
          displayValue={text}
          ariaLabel="Based in"
          placeholder="Search for a city"
          emptyLabel={query.trim().length < 2 ? "Type a city name" : "No cities found"}
          allowCustom={(q) => ({
            value: `${FREE_PREFIX}${q}`,
            label: `Use “${q}”`,
            icon: <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />,
          })}
          renderLabel={renderLabel}
          className="w-full"
        />
        {text && (
          <IconButton
            label="Clear"
            icon={X}
            onClick={() => {
              setText("");
              setGeonameId("");
            }}
          />
        )}
      </div>
      {geonameId === "" && text !== "" && text === value.currentLocation && (
        <BasedInFeedback value={value} />
      )}
    </div>
  );
}
