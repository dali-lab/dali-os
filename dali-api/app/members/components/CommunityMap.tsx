import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { cn } from "~/lib/cn";
import { MAP_TILES_ORIGIN, minZoomToFill, type CommunityPerson, type CommunityPlace, type MapBounds } from "~/members/lib/community";
import { eventDateBlock } from "~/members/lib/community-view";
import type { CommunityEvent } from "~/members/lib/community.server";

export type MapPlace = CommunityPlace<CommunityPerson> & { faded?: boolean };
export type MapEvent = Pick<CommunityEvent, "id" | "source" | "title" | "startsAt" | "lat" | "lng">;

export function normalizeBounds(b: { south: number; west: number; north: number; east: number }): MapBounds {
  if (b.east - b.west >= 360) return { ...b, west: -180, east: 180 };
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return { ...b, west: wrap(b.west), east: wrap(b.east) };
}

export const mapStyleUrl = (dark: boolean) => `${MAP_TILES_ORIGIN}/styles/${dark ? "dark" : "positron"}`;
const isDark = () => !document.documentElement.classList.contains("light");

const AVATAR = 30;
const EVENT_PIN = { width: 44, height: 48, lift: 18 };
const Z = { event: 1, place: 2, selectedPlace: 3, selectedEvent: 4, hover: 5 };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Built as DOM nodes, not an HTML string, so a name or photo URL can never be read as markup.
function pinElement(place: MapPlace, selected: boolean): HTMLElement {
  const root = document.createElement("div");
  root.dataset.faded = String(Boolean(place.faded));
  root.style.cssText = `opacity:${place.faded ? 0.35 : 1};display:flex;align-items:center;gap:6px;width:max-content;cursor:pointer;transition:transform 150ms ease-out;transform-origin:${AVATAR / 2}px 50%`;

  const faces = document.createElement("div");
  faces.style.cssText = "display:flex";
  place.people.slice(0, 3).forEach((a, i) => {
    const ring = `box-shadow:0 0 0 2px ${selected ? "var(--color-os-accent)" : "var(--color-os-card)"}`;
    const base = `width:${AVATAR}px;height:${AVATAR}px;border-radius:9999px;flex:none;${ring};margin-left:${i === 0 ? 0 : -10}px`;
    if (a.photoUrl) {
      const img = document.createElement("img");
      img.src = a.photoUrl;
      img.alt = "";
      img.style.cssText = `${base};object-fit:cover;background:var(--color-os-container)`;
      faces.append(img);
    } else {
      const span = document.createElement("span");
      span.textContent = initials(a.name);
      span.style.cssText = `${base};display:flex;align-items:center;justify-content:center;background:var(--color-os-accent);color:var(--color-os-bg);font-size:11px;font-weight:700`;
      faces.append(span);
    }
  });

  const label = document.createElement("span");
  const extra = place.people.length - 1;
  label.textContent = extra > 0 ? `${place.people[0].name} +${extra}` : place.people[0].name;
  label.style.cssText = `padding:2px 8px;border-radius:9999px;background:var(--color-os-card);color:var(--color-foreground);font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)${selected ? ",0 0 0 2px var(--color-os-accent)" : ""}`;

  root.append(faces, label);
  return root;
}

function eventPinElement(e: MapEvent, tz: string, selected: boolean): HTMLElement {
  const { month, day } = eventDateBlock(e.startsAt, tz);
  const root = document.createElement("div");
  root.className = `community-event-pin community-event-pin--${e.source}${selected ? " is-selected" : ""}`;
  const m = document.createElement("span");
  m.className = "community-event-pin__month";
  m.textContent = month;
  const d = document.createElement("span");
  d.className = "community-event-pin__day";
  d.textContent = day;
  root.append(m, d);
  return root;
}

const placeSignature = (p: MapPlace, selected: boolean) =>
  JSON.stringify([
    p.lat,
    p.lng,
    p.label,
    selected,
    Boolean(p.faded),
    p.people.length,
    p.people.slice(0, 3).map((a) => [a.name, a.photoUrl]),
  ]);

const eventSignature = (e: MapEvent, tz: string, selected: boolean) =>
  JSON.stringify([e.lat, e.lng, e.title, e.source, e.startsAt, tz, selected]);

type Pin = { marker: Marker; signature: string };

export function CommunityMap({
  places,
  events,
  tz,
  selectedKey,
  selectedEventId,
  onSelect,
  onSelectEvent,
  onBoundsChange,
  className,
}: {
  places: MapPlace[];
  events: MapEvent[];
  tz: string;
  selectedKey: string | null;
  selectedEventId: string | null;
  onSelect: (key: string | null) => void;
  onSelectEvent: (id: string) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const placePins = useRef(new Map<string, Pin>());
  const eventPins = useRef(new Map<string, Pin>());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectEventRef = useRef(onSelectEvent);
  onSelectEventRef.current = onSelectEvent;
  const onBoundsRef = useRef(onBoundsChange);
  onBoundsRef.current = onBoundsChange;
  const fittedFor = useRef<string | null>(null);

  function sync<T>(
    pins: Map<string, Pin>,
    items: { key: string; item: T; lng: number; lat: number; signature: string }[],
    build: (item: T) => { element: HTMLElement; offset: [number, number]; z: number },
  ) {
    const L = lib.current;
    if (!L || !map.current) return;
    const seen = new Set<string>();
    for (const { key, item, lng, lat, signature } of items) {
      seen.add(key);
      const existing = pins.get(key);
      if (existing?.signature === signature) continue;
      existing?.marker.remove();
      const { element, offset, z } = build(item);
      const wrapper = document.createElement("div");
      wrapper.style.zIndex = String(z);
      wrapper.append(element);
      const marker = new L.Marker({ element: wrapper, anchor: "top-left", offset })
        .setLngLat([lng, lat])
        .addTo(map.current);
      pins.set(key, { marker, signature });
    }
    for (const [key, pin] of pins) {
      if (seen.has(key)) continue;
      pin.marker.remove();
      pins.delete(key);
    }
  }

  function draw() {
    sync(
      placePins.current,
      places.map((p) => ({ key: p.key, item: p, lng: p.lng, lat: p.lat, signature: placeSignature(p, p.key === selectedKey) })),
      (p) => {
        const selected = p.key === selectedKey;
        const element = pinElement(p, selected);
        element.title = p.label;
        const z = selected ? Z.selectedPlace : Z.place;
        element.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onSelectRef.current(selected ? null : p.key);
        });
        element.addEventListener("mouseenter", () => {
          element.parentElement!.style.zIndex = String(Z.hover);
          element.style.transform = "scale(1.15)";
        });
        element.addEventListener("mouseleave", () => {
          element.parentElement!.style.zIndex = String(z);
          element.style.transform = "";
        });
        return { element, offset: [-AVATAR / 2, -AVATAR / 2], z };
      },
    );
    sync(
      eventPins.current,
      events.flatMap((e) =>
        e.lat == null || e.lng == null
          ? []
          : [{ key: e.id, item: e, lng: e.lng, lat: e.lat, signature: eventSignature(e, tz, e.id === selectedEventId) }],
      ),
      (e) => {
        const selected = e.id === selectedEventId;
        const element = eventPinElement(e, tz, selected);
        element.title = e.title;
        element.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onSelectEventRef.current(e.id);
        });
        return {
          element,
          offset: [-EVENT_PIN.width / 2, -(EVENT_PIN.height + EVENT_PIN.lift)],
          z: selected ? Z.selectedEvent : Z.event,
        };
      },
    );
    fitIfNeeded();
  }

  function emitBounds() {
    const b = map.current?.getBounds();
    if (b) {
      onBoundsRef.current(
        normalizeBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }),
      );
    }
  }

  // A fit against a 0-height container (the page can mount inside a hidden kept tab) computes a garbage zoom.
  function fitIfNeeded() {
    const L = lib.current;
    if (!L || !map.current || !el.current || el.current.clientHeight === 0) return;
    const fitKey = places.map((p) => p.key).join("|");
    if (fittedFor.current === fitKey) return;
    const first = fittedFor.current === null;
    fittedFor.current = fitKey;
    if (places.length > 0) {
      const bounds = new L.LngLatBounds();
      for (const p of places) bounds.extend([p.lng, p.lat]);
      map.current.fitBounds(bounds, { padding: 48, maxZoom: 5, duration: first ? 0 : undefined });
    } else {
      map.current.jumpTo({ center: [0, 25], zoom: 1 });
    }
  }
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const emitRef = useRef(emitBounds);
  emitRef.current = emitBounds;
  const fitRef = useRef(fitIfNeeded);
  fitRef.current = fitIfNeeded;

  useEffect(() => {
    let cancelled = false;
    let themeObserver: MutationObserver | null = null;
    void import("maplibre-gl").then((L) => {
      if (cancelled || !el.current) return;
      lib.current = L;
      L.setWorkerUrl(workerUrl);
      let dark = isDark();
      const m = new L.Map({
        container: el.current,
        style: mapStyleUrl(dark),
        center: [0, 25],
        zoom: 1,
        minZoom: minZoomToFill(el.current.clientHeight),
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
        attributionControl: { compact: true },
      });
      m.touchZoomRotate.disableRotation();
      m.keyboard.disableRotation();
      m.on("resize", () => m.setMinZoom(minZoomToFill(m.getContainer().clientHeight)));
      m.on("moveend", () => emitRef.current());
      map.current = m;
      themeObserver = new MutationObserver(() => {
        if (isDark() === dark) return;
        dark = isDark();
        m.setStyle(mapStyleUrl(dark));
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      drawRef.current();
      emitRef.current();
    });
    // The map can mount at 0×0 in a hidden kept tab; the first fit waits until it has a size.
    const ro = new ResizeObserver(() => {
      if (!el.current || el.current.clientHeight === 0) return;
      fitRef.current();
    });
    if (el.current) ro.observe(el.current);
    return () => {
      cancelled = true;
      ro.disconnect();
      themeObserver?.disconnect();
      placePins.current.clear();
      eventPins.current.clear();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, events, tz, selectedKey, selectedEventId]);

  return (
    <div
      ref={el}
      className={cn("isolate", className)}
      role="application"
      aria-label="Map of alumni and events"
    />
  );
}
