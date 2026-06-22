import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { ComponentType } from "react";
import type { GlobalGraph, GraphNode, NodeType } from "~/lib/connections";

// Obsidian-style global graph. The force layout / canvas renderer lives in
// `react-force-graph-2d`, which reaches for `window` + canvas at import time —
// so it is loaded ONLY in the browser, behind a mounted guard + dynamic
// import. Server render (and `npm run build`) never touch it.

const FILTERS_KEY = "dali:graph:filters";
const EXTREME_NODE_COUNT = 2000;

// Display order + label for each node type's filter toggle.
const NODE_TYPES: { type: NodeType; label: string }[] = [
  { type: "project", label: "Projects" },
  { type: "person", label: "People" },
  { type: "domain", label: "Domains" },
  { type: "term", label: "Terms" },
  { type: "partner", label: "Partners" },
  { type: "task", label: "Tasks" },
  { type: "epic", label: "Epics" },
  { type: "sprint", label: "Sprints" },
  { type: "document", label: "Documents" },
  { type: "file", label: "Files" },
];

// Color per node type (hex so the canvas renderer can use them directly —
// canvas can't read CSS custom properties).
const NODE_COLOR: Record<NodeType, string> = {
  project: "#ef6f5b",
  person: "#4f7cff",
  domain: "#8b5cf6",
  term: "#6b7280",
  partner: "#10b981",
  task: "#94a3b8",
  epic: "#f59e0b",
  sprint: "#eab308",
  document: "#0ea5e9",
  file: "#64748b",
};

// Relative node radius per type — anchors (project/person/domain) read larger
// than leaf work items.
const NODE_SIZE: Record<NodeType, number> = {
  project: 7,
  person: 6,
  domain: 6,
  partner: 5,
  term: 5,
  epic: 5,
  sprint: 4,
  task: 3,
  document: 3,
  file: 3,
};

type Filters = Record<NodeType, boolean>;

const ALL_ON: Filters = NODE_TYPES.reduce((acc, { type }) => {
  acc[type] = true;
  return acc;
}, {} as Filters);

function loadFilters(): Filters {
  if (typeof window === "undefined") return ALL_ON;
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return ALL_ON;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    // Merge over ALL_ON so a newly-added node type defaults to visible even if
    // an older persisted object predates it.
    return { ...ALL_ON, ...parsed };
  } catch {
    return ALL_ON;
  }
}

// react-force-graph datum shapes. We mutate x/y/vx/vy on these at runtime, so
// they carry the simulation fields the lib writes back.
type FGNode = GraphNode & { x?: number; y?: number };
type FGLink = { source: string | FGNode; target: string | FGNode; type: string };

// Resolve a link endpoint to its node id (the lib swaps id strings for node
// objects once the simulation initializes).
function endpointId(end: string | FGNode): string {
  return typeof end === "string" ? end : end.id;
}

export function GraphExplorer({ graph }: { graph: GlobalGraph }) {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [ForceGraph, setForceGraph] = useState<ComponentType<Record<string, unknown>> | null>(null);
  const [filters, setFilters] = useState<Filters>(ALL_ON);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Client-only: load persisted filters and dynamically import the canvas lib
  // after mount so it never runs during SSR / build.
  useEffect(() => {
    setMounted(true);
    setFilters(loadFilters());
    let cancelled = false;
    import("react-force-graph-2d").then((mod) => {
      if (!cancelled) setForceGraph(() => mod.default as ComponentType<Record<string, unknown>>);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Track the container size so the canvas fills the panel responsively.
  useEffect(() => {
    if (!mounted) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  const toggleFilter = useCallback((type: NodeType) => {
    setFilters((prev) => {
      const next = { ...prev, [type]: !prev[type] };
      try {
        window.localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
      } catch {
        // ignore quota / disabled storage — the toggle still applies in-session
      }
      return next;
    });
  }, []);

  // Apply the type filters: drop hidden-type nodes, then drop edges whose
  // endpoints no longer exist.
  const data = useMemo(() => {
    const nodes = graph.nodes.filter((n) => filters[n.type]);
    const visible = new Set(nodes.map((n) => n.id));
    const links = graph.edges
      .filter((e) => visible.has(e.source) && visible.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: e.type }));
    return { nodes: nodes.map((n) => ({ ...n })) as FGNode[], links };
  }, [graph, filters]);

  // Neighbor + incident-edge sets for the hovered node, used to highlight.
  const { neighborIds, incidentLinks } = useMemo(() => {
    if (!hoverId) return { neighborIds: new Set<string>(), incidentLinks: new Set<FGLink>() };
    const neighbors = new Set<string>([hoverId]);
    const incident = new Set<FGLink>();
    for (const l of data.links as FGLink[]) {
      const s = endpointId(l.source);
      const t = endpointId(l.target);
      if (s === hoverId || t === hoverId) {
        incident.add(l);
        neighbors.add(s);
        neighbors.add(t);
      }
    }
    return { neighborIds: neighbors, incidentLinks: incident };
  }, [hoverId, data.links]);

  // Open an entity page. Inside the TabWorkspace iframe, hand the URL to the
  // shell so it lands in a real workspace tab instead of navigating the
  // chrome-less embed; standalone, navigate directly.
  const openEntity = useCallback(
    (node: FGNode) => {
      if (!node.href) return;
      if (typeof window !== "undefined" && window.self !== window.top) {
        window.parent.postMessage(
          { type: "dali:openTab", url: node.href, label: node.label },
          window.location.origin,
        );
      } else {
        navigate(node.href);
      }
    },
    [navigate],
  );

  const totalVisible = data.nodes.length;
  const extreme = graph.nodes.length > EXTREME_NODE_COUNT;

  return (
    <div className="fixed inset-0 flex flex-col bg-page">
      <header className="flex items-center justify-between gap-3 px-4 h-12 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="font-heading font-bold text-foreground truncate">Lab Graph</h1>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {totalVisible} {totalVisible === 1 ? "node" : "nodes"} shown
          </span>
        </div>
      </header>

      {extreme && (
        <p className="px-4 py-1.5 text-xs text-muted-foreground bg-muted/50 border-b border-border flex-shrink-0">
          This is a large graph ({graph.nodes.length} nodes). Use the filters to
          focus; drag, scroll to zoom, and click a node to open it.
        </p>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Filter panel */}
        <aside className="w-44 flex-shrink-0 border-r border-border bg-card overflow-y-auto p-3 flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Show
          </h2>
          {NODE_TYPES.map(({ type, label }) => (
            <label
              key={type}
              className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={filters[type]}
                onChange={() => toggleFilter(type)}
                className="accent-accent-coral"
              />
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: NODE_COLOR[type] }}
                aria-hidden="true"
              />
              <span className="truncate">{label}</span>
            </label>
          ))}
        </aside>

        {/* Canvas */}
        <div ref={containerRef} className="flex-1 min-w-0 relative">
          {mounted && ForceGraph && size.width > 0 ? (
            <ForceGraph
              graphData={data}
              width={size.width}
              height={size.height}
              nodeId="id"
              nodeLabel={(n: FGNode) => n.label}
              nodeVal={(n: FGNode) => NODE_SIZE[n.type]}
              nodeColor={(n: FGNode) =>
                hoverId && !neighborIds.has(n.id) ? "rgba(148,163,184,0.25)" : NODE_COLOR[n.type]
              }
              linkColor={(l: FGLink) =>
                hoverId
                  ? incidentLinks.has(l)
                    ? "#94a3b8"
                    : "rgba(203,213,225,0.15)"
                  : "rgba(148,163,184,0.4)"
              }
              linkWidth={(l: FGLink) => (incidentLinks.has(l) ? 1.5 : 0.5)}
              onNodeHover={(n: FGNode | null) => setHoverId(n ? n.id : null)}
              onNodeClick={(n: FGNode) => openEntity(n)}
              enableNodeDrag={true}
              cooldownTicks={100}
              nodeCanvasObjectMode={() => "after"}
              nodeCanvasObject={(n: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
                // Draw a label beside larger nodes once zoomed in enough that
                // text won't smear into a hairball.
                const r = NODE_SIZE[n.type];
                if (scale < 1.4 && r < 6) return;
                const label = n.label;
                const fontSize = Math.max(10 / scale, 2);
                ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillStyle =
                  hoverId && !neighborIds.has(n.id) ? "rgba(100,116,139,0.4)" : "#334155";
                ctx.fillText(label, (n.x ?? 0) + r + 1.5, n.y ?? 0);
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Loading graph…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
