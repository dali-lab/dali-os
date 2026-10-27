import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "~/lib/cn";
import { MAX_LAT, minZoomToFill, type ConnectPlace } from "~/members/lib/connect";

// OpenStreetMap's own tile server: keyless. It only draws a light map, so the
// dark theme inverts the tile pane (hue-rotated back so water stays blue).
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DARK_FILTER = "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)";

const AVATAR = 30;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// A pin is the photos of the people there (up to three, overlapping) and a
// name label. Built as DOM nodes, not an HTML string, so a name or photo URL
// can never be read as markup.
function pinElement(place: ConnectPlace, selected: boolean): HTMLElement {
  const root = document.createElement("div");
  // Leaflet positions the marker with a transform on its own wrapper, so the
  // hover scale goes on this inner node, growing from the first photo's centre.
  root.style.cssText = `display:flex;align-items:center;gap:6px;width:max-content;cursor:pointer;transition:transform 150ms ease-out;transform-origin:${AVATAR / 2}px 50%`;

  const faces = document.createElement("div");
  faces.style.cssText = "display:flex";
  place.alumni.slice(0, 3).forEach((a, i) => {
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
  const extra = place.alumni.length - 1;
  label.textContent = extra > 0 ? `${place.alumni[0].name} +${extra}` : place.alumni[0].name;
  label.style.cssText = `padding:2px 8px;border-radius:9999px;background:var(--color-os-card);color:var(--color-foreground);font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)${selected ? ",0 0 0 2px var(--color-os-accent)" : ""}`;

  root.append(faces, label);
  return root;
}

const pinRoot = (marker: Marker): HTMLElement =>
  marker.getElement()!.firstElementChild as HTMLElement;

export function ConnectMap({
  places,
  selectedKey,
  onSelect,
  className,
}: {
  places: ConnectPlace[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const pins = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // The fit-to-pins only happens when the set of places changes, not on select.
  const fittedFor = useRef<string | null>(null);

  function draw() {
    const L = leaflet.current;
    if (!L || !map.current || !pins.current) return;
    pins.current.clearLayers();
    for (const p of places) {
      const selected = p.key === selectedKey;
      L.marker([p.lat, p.lng], {
        // Anchored on the first photo's centre; the label runs off to the right.
        icon: L.divIcon({
          html: pinElement(p, selected),
          className: "",
          iconSize: [AVATAR, AVATAR],
          iconAnchor: [AVATAR / 2, AVATAR / 2],
        }),
        title: p.label,
        zIndexOffset: selected ? 1000 : 0,
      })
        .on("click", () => onSelectRef.current(selected ? null : p.key))
        .on("mouseover", (e) => {
          e.target.setZIndexOffset(2000);
          pinRoot(e.target).style.transform = "scale(1.15)";
        })
        .on("mouseout", (e) => {
          e.target.setZIndexOffset(selected ? 1000 : 0);
          pinRoot(e.target).style.transform = "";
        })
        .addTo(pins.current);
    }
    fitIfNeeded();
  }

  // Separate from draw() so the resize observer can run a pending fit without
  // rebuilding every marker. A fit against a 0-height container (the page can
  // mount inside a hidden kept tab) computes a garbage zoom, so it waits until
  // the container has a size.
  function fitIfNeeded() {
    const L = leaflet.current;
    if (!L || !map.current || !el.current || el.current.clientHeight === 0) return;
    const fitKey = places.map((p) => p.key).join("|");
    if (fittedFor.current === fitKey) return;
    fittedFor.current = fitKey;
    if (places.length > 0) {
      map.current.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])), {
        padding: [48, 48],
        maxZoom: 6,
      });
    } else {
      map.current.setView([25, 0], 2);
    }
  }
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const fitRef = useRef(fitIfNeeded);
  fitRef.current = fitIfNeeded;

  // Leaflet reads `window` at import, so it loads in the browser only.
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      if (cancelled || !el.current) return;
      const L = mod.default ?? mod;
      leaflet.current = L;
      const dark = !document.documentElement.classList.contains("light");
      map.current = L.map(el.current, {
        worldCopyJump: true,
        minZoom: minZoomToFill(el.current.clientHeight),
        // Pan sideways forever, but never past the poles into the grey void.
        maxBounds: L.latLngBounds([-MAX_LAT, -540], [MAX_LAT, 540]),
        maxBoundsViscosity: 1,
      }).setView([25, 0], 2);
      map.current.on("resize", (e) => {
        map.current?.setMinZoom(minZoomToFill(e.newSize.y));
      });
      L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map.current);
      if (dark) map.current.getPane("tilePane")!.style.filter = DARK_FILTER;
      pins.current = L.layerGroup().addTo(map.current);
      drawRef.current();
    });
    // Leaflet only re-measures itself on window resize. The map can initialize
    // at 0×0 (hidden kept tab, display:none ancestor) or get resized by layout
    // alone (pane changes), and without this it stays a grey void until the
    // window itself resizes.
    const ro = new ResizeObserver(() => {
      if (!map.current || !el.current || el.current.clientHeight === 0) return;
      map.current.invalidateSize();
      fitRef.current();
    });
    if (el.current) ro.observe(el.current);
    return () => {
      cancelled = true;
      ro.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, selectedKey]);

  // isolate: Leaflet stacks its panes at z-index 400–700, which would
  // otherwise float the map (and pins at 600+) over the app's own fixed
  // overlays — the ⌘K palette sits at z-50. Trapping them in their own
  // stacking context keeps every overlay above the map.
  return (
    <div
      ref={el}
      className={cn("isolate", className)}
      role="application"
      aria-label="Map of alumni"
    />
  );
}
