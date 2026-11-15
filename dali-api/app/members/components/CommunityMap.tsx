import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { cn } from "~/lib/cn";
import { initialsFromName } from "~/lib/display";
import {
  HOME_ZOOM,
  MAP_TILES_ORIGIN,
  clusterPlaces,
  edgePosition,
  mergeEdgePins,
  minZoomToFill,
  type CommunityPerson,
  type CommunityPlace,
  type EdgeSide,
  type EdgeView,
  type MapBounds,
} from "~/members/lib/community";
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

// OpenFreeMap hides state borders below zoom 8 in light and draws them near-black in dark.
const STATE_BORDERS: Record<string, { minzoom?: number; color: string }> = {
  boundary_3: { minzoom: 3, color: "hsl(0,0%,62%)" },
  boundary_state: { color: "hsl(0,0%,38%)" },
};

export function showStateBorders(m: Pick<MapLibreMap, "getLayer" | "setLayerZoomRange" | "setPaintProperty">) {
  for (const [id, { minzoom, color }] of Object.entries(STATE_BORDERS)) {
    if (!m.getLayer(id)) continue;
    if (minzoom != null) m.setLayerZoomRange(id, minzoom, 24);
    m.setPaintProperty(id, "line-color", color);
  }
}

const AVATAR = 30;
const EVENT_PIN = { width: 44, height: 48, lift: 18 };
const Z = { event: 1, place: 2, selectedPlace: 3, selectedEvent: 4, hover: 5 };
const CLUSTER_FIT_MAX_ZOOM = 10;

// Built as DOM nodes, not an HTML string, so a name or photo URL can never be read as markup.
function pinElement(cluster: MapPlace[], selected: boolean, dim: boolean): HTMLElement {
  const faded = cluster.every((p) => p.faded);
  const people = (faded ? cluster : cluster.filter((p) => !p.faded)).flatMap((p) => p.people);
  const root = document.createElement("div");
  root.dataset.faded = String(faded);
  root.style.cssText = `opacity:${faded ? 0.35 : dim ? 0.5 : 1};display:flex;align-items:center;gap:6px;width:max-content;cursor:pointer;transition:transform 150ms ease-out;transform-origin:${AVATAR / 2}px 50%`;

  const faces = document.createElement("div");
  faces.style.cssText = "display:flex";
  people.slice(0, 3).forEach((a, i) => {
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
      span.textContent = initialsFromName(a.name);
      span.style.cssText = `${base};display:flex;align-items:center;justify-content:center;background:var(--color-os-accent);color:var(--color-os-bg);font-size:11px;font-weight:700`;
      faces.append(span);
    }
  });

  const label = document.createElement("span");
  const extra = people.length - 1;
  label.textContent =
    cluster.length > 1 ? `${people.length} people` : extra > 0 ? `${people[0].name} +${extra}` : people[0].name;
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

const clusterSignature = (cluster: MapPlace[], selected: boolean, dim: boolean) =>
  JSON.stringify([
    selected,
    dim,
    cluster.map((p) => [p.lat, p.lng, p.label, Boolean(p.faded), p.people.length]),
    cluster.flatMap((p) => p.people.slice(0, 3)).slice(0, 3).map((a) => [a.name, a.photoUrl]),
  ]);

const eventSignature = (e: MapEvent, tz: string, selected: boolean) =>
  JSON.stringify([e.lat, e.lng, e.title, e.source, e.startsAt, tz, selected]);

type Pin = { marker: Marker; signature: string };

export function CommunityMap({
  places,
  events,
  tz,
  home,
  selectedKeys,
  selectedEventId,
  onSelect,
  onSelectEvent,
  onBoundsChange,
  fitRequest = null,
  dimPeople = false,
  className,
}: {
  places: MapPlace[];
  events: MapEvent[];
  tz: string;
  home: { lat: number; lng: number } | null;
  selectedKeys: string[] | null;
  selectedEventId: string | null;
  onSelect: (keys: string[] | null) => void;
  onSelectEvent: (id: string) => void;
  onBoundsChange: (bounds: MapBounds) => void;
  fitRequest?: { keys: string[]; id: number } | null;
  dimPeople?: boolean;
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
  const [edgeView, setEdgeView] = useState<EdgeView | null>(null);
  const viewSet = useRef(false);
  const zoomBucket = useRef(1);

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
    const chosen = new Set(selectedKeys ?? []);
    const isSelected = (cluster: MapPlace[]) => cluster.every((p) => chosen.has(p.key));
    sync(
      placePins.current,
      clusterPlaces(places, zoomBucket.current).map((cluster) => ({
        key: cluster.map((p) => p.key).join("|"),
        item: cluster,
        lng: cluster[0].lng,
        lat: cluster[0].lat,
        signature: clusterSignature(cluster, isSelected(cluster), dimPeople),
      })),
      (cluster) => {
        const selected = isSelected(cluster);
        const element = pinElement(cluster, selected, dimPeople);
        element.title = cluster.map((p) => p.label).join(", ");
        const z = selected ? Z.selectedPlace : Z.place;
        element.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (selected) {
            onSelectRef.current(null);
            return;
          }
          onSelectRef.current(cluster.map((p) => p.key));
          if (cluster.length > 1) fitTo(cluster, CLUSTER_FIT_MAX_ZOOM);
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
    setInitialView();
  }

  function fitTo(points: { lat: number; lng: number }[], maxZoom: number, instant = false) {
    const L = lib.current;
    if (!L || !map.current) return;
    const bounds = new L.LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    map.current.fitBounds(bounds, { padding: 48, maxZoom, duration: instant ? 0 : undefined });
  }

  function emitBounds() {
    const b = map.current?.getBounds();
    if (b) {
      onBoundsRef.current(
        normalizeBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }),
      );
    }
  }

  function readEdgeView() {
    const m = map.current;
    const box = el.current;
    if (!m || !box) return;
    const b = m.getBounds();
    const c = m.getCenter();
    setEdgeView({
      center: { lat: c.lat, lng: c.lng },
      bounds: normalizeBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }),
      width: box.clientWidth,
      height: box.clientHeight,
    });
  }

  // A fit against a 0-height container (the page can mount inside a hidden kept tab) computes a garbage zoom.
  function setInitialView() {
    if (viewSet.current || !map.current || !el.current || el.current.clientHeight === 0) return;
    viewSet.current = true;
    if (home) map.current.jumpTo({ center: [home.lng, home.lat], zoom: HOME_ZOOM });
    else if (places.length > 0) fitTo(places, 5, true);
    else map.current.jumpTo({ center: [0, 25], zoom: 1 });
  }
  const edgeRef = useRef(readEdgeView);
  edgeRef.current = readEdgeView;
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const emitRef = useRef(emitBounds);
  emitRef.current = emitBounds;
  const initialViewRef = useRef(setInitialView);
  initialViewRef.current = setInitialView;

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
      m.on("style.load", () => showStateBorders(m));
      let frame = 0;
      const scheduleEdges = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => edgeRef.current());
      };
      m.on("move", scheduleEdges);
      m.on("resize", scheduleEdges);
      m.on("moveend", () => emitRef.current());
      m.on("zoomend", () => {
        const bucket = Math.floor(m.getZoom());
        if (bucket === zoomBucket.current) return;
        zoomBucket.current = bucket;
        drawRef.current();
      });
      map.current = m;
      themeObserver = new MutationObserver(() => {
        if (isDark() === dark) return;
        dark = isDark();
        m.setStyle(mapStyleUrl(dark));
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      drawRef.current();
      emitRef.current();
      edgeRef.current();
    });
    // The map can mount at 0×0 in a hidden kept tab; the first view waits until it has a size.
    const ro = new ResizeObserver(() => {
      if (!el.current || el.current.clientHeight === 0) return;
      initialViewRef.current();
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
  }, [places, events, tz, selectedKeys, selectedEventId, dimPeople]);

  useEffect(() => {
    if (!fitRequest) return;
    const wanted = new Set(fitRequest.keys);
    const points = places.filter((p) => wanted.has(p.key));
    if (points.length > 0) fitTo(points, CLUSTER_FIT_MAX_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest?.id]);

  const edgePins = useMemo(() => {
    if (!edgeView) return [];
    return mergeEdgePins(
      places.flatMap((p) => {
        if (p.faded) return [];
        const pos = edgePosition(edgeView, p, EDGE_INSET);
        return pos ? [{ ...pos, key: p.key, label: p.label, count: p.people.length }] : [];
      }),
    );
  }, [places, edgeView]);

  function pickEdge(keys: string[]) {
    onSelectRef.current(keys);
    fitTo(places.filter((p) => keys.includes(p.key)), CLUSTER_FIT_MAX_ZOOM);
  }

  return (
    <div className={cn("relative", className)}>
      <div ref={el} className="isolate h-full w-full" role="application" aria-label="Map of alumni and events" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {edgePins.map((pin) => (
          <EdgePinButton key={pin.keys.join("|")} pin={pin} dim={dimPeople} onPick={() => pickEdge(pin.keys)} />
        ))}
      </div>
    </div>
  );
}

const EDGE_INSET = 26;
const EDGE_CHEVRON = { left: ChevronLeft, right: ChevronRight, top: ChevronUp, bottom: ChevronDown } as const;
const EDGE_LABEL_CLASS: Record<EdgeSide, string> = {
  left: "left-full top-1/2 ml-1 -translate-y-1/2",
  right: "right-full top-1/2 mr-1 -translate-y-1/2",
  top: "top-full left-1/2 mt-0.5 -translate-x-1/2",
  bottom: "bottom-full left-1/2 mb-0.5 -translate-x-1/2",
};
const EDGE_CHEVRON_CLASS: Record<EdgeSide, string> = {
  left: "right-full top-1/2 mr-0.5 -translate-y-1/2",
  right: "left-full top-1/2 ml-0.5 -translate-y-1/2",
  top: "bottom-full left-1/2 mb-0 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-0 -translate-x-1/2",
};

function EdgePinButton({
  pin,
  dim,
  onPick,
}: {
  pin: ReturnType<typeof mergeEdgePins>[number];
  dim: boolean;
  onPick: () => void;
}) {
  const Chevron = EDGE_CHEVRON[pin.side];
  return (
    <button
      type="button"
      data-edge-pin={pin.side}
      aria-label={`${pin.label}, ${pin.count} ${pin.count === 1 ? "person" : "people"}, outside the view`}
      onClick={onPick}
      style={{
        left: pin.x,
        top: pin.y,
        opacity: dim ? 0.5 : 1,
        background: "color-mix(in srgb, var(--os-accent-ink) 75%, transparent)",
      }}
      className="pointer-events-auto absolute flex h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold leading-none text-white shadow"
    >
      {pin.count}
      <span
        className={cn(
          "absolute max-w-[120px] truncate whitespace-nowrap text-[11px] font-semibold text-os-grey",
          EDGE_LABEL_CLASS[pin.side],
        )}
      >
        {pin.label}
      </span>
      <Chevron className={cn("absolute h-3 w-3 text-os-grey", EDGE_CHEVRON_CLASS[pin.side])} aria-hidden />
    </button>
  );
}
