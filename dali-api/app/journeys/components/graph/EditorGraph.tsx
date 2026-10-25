import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "~/lib/cn";
import { canAddDependency } from "~/journeys/lib/journey-edit";
import type { Journey, Point } from "~/journeys/lib/types";
import { DRAG_THRESHOLD, GraphCanvas, useNodeHeights, type GraphView } from "./GraphCanvas";
import { connectionPath, edgePath, nodeAt, nodeBox } from "./graph-geometry";
import { EditorModuleNode, type ConnectState } from "./EditorModuleNode";

const KEY_NUDGE = 20;

interface Drag {
  id: string;
  startClient: Point;
  startGraph: Point;
  origin: Point;
  moved: boolean;
}

interface Connect {
  sourceId: string;
  point: Point;
  targetId: string | null;
}

export function edgeId(prereqId: string, moduleId: string): string {
  return `${prereqId}->${moduleId}`;
}

export function parseEdgeId(id: string): { prereqId: string; moduleId: string } | null {
  const [prereqId, moduleId] = id.split("->");
  return prereqId && moduleId ? { prereqId, moduleId } : null;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

/** The authoring map: drag modules around, drag from a handle to add a prerequisite, select an edge to remove it. */
export function EditorGraph({
  journey,
  selectedId,
  selectedEdgeId,
  issueCounts,
  onSelectModule,
  onSelectEdge,
  onMove,
  onConnect,
  onRemoveDependency,
}: {
  journey: Journey;
  selectedId: string | null;
  selectedEdgeId: string | null;
  issueCounts: Record<string, number>;
  onSelectModule: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onMove: (id: string, position: Point) => void;
  onConnect: (prereqId: string, moduleId: string) => void;
  onRemoveDependency: (moduleId: string, prereqId: string) => void;
}) {
  const { heights, measure } = useNodeHeights();
  const viewRef = useRef<GraphView | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; pos: Point } | null>(null);
  const [connect, setConnect] = useState<Connect | null>(null);

  const positionOf = (id: string, stored: Point) => (dragPos?.id === id ? dragPos.pos : stored);
  const boxes = useMemo(
    () => journey.modules.map((m) => nodeBox(m.id, dragPos?.id === m.id ? dragPos.pos : m.position, heights[m.id])),
    [journey.modules, heights, dragPos],
  );
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);
  // Fitting reads stored positions only, so a drag never re-centres the view.
  const fitBoxes = useMemo(
    () => journey.modules.map((m) => nodeBox(m.id, m.position, heights[m.id])),
    [journey.modules, heights],
  );

  const latest = useRef({ journey, onMove, onConnect, onSelectModule, onSelectEdge, byId });
  latest.current = { journey, onMove, onConnect, onSelectModule, onSelectEdge, byId };

  useEffect(() => {
    if (!selectedEdgeId) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.key !== "Delete" && e.key !== "Backspace") || isTyping(e.target)) return;
      const edge = parseEdgeId(selectedEdgeId);
      if (!edge) return;
      e.preventDefault();
      onRemoveDependency(edge.moduleId, edge.prereqId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEdgeId, onRemoveDependency]);

  const toGraph = (e: { clientX: number; clientY: number }) =>
    viewRef.current?.toGraph(e.clientX, e.clientY) ?? { x: e.clientX, y: e.clientY };

  // Window listeners for the life of one gesture, so the pointer can leave the
  // node (or the canvas) mid-drag without the drag getting stuck.
  const track = (onMoveEvent: (e: globalThis.PointerEvent) => void, onEnd: (e: globalThis.PointerEvent, cancelled: boolean) => void) => {
    const move = (e: globalThis.PointerEvent) => onMoveEvent(e);
    const up = (e: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onEnd(e, e.type === "pointercancel");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>, id: string, origin: Point) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || (e.target as Element).closest("[data-graph-handle]")) return;
    const drag: Drag = {
      id,
      startClient: { x: e.clientX, y: e.clientY },
      startGraph: toGraph(e),
      origin,
      moved: false,
    };
    let pos = origin;
    track(
      (ev) => {
        if (!drag.moved && Math.hypot(ev.clientX - drag.startClient.x, ev.clientY - drag.startClient.y) < DRAG_THRESHOLD) return;
        drag.moved = true;
        const g = toGraph(ev);
        pos = { x: Math.round(drag.origin.x + g.x - drag.startGraph.x), y: Math.round(drag.origin.y + g.y - drag.startGraph.y) };
        setDragPos({ id, pos });
      },
      (_ev, cancelled) => {
        setDragPos(null);
        const l = latest.current;
        if (drag.moved) {
          if (!cancelled) l.onMove(id, pos);
        } else if (!cancelled) {
          l.onSelectEdge(null);
          l.onSelectModule(id);
        }
      },
    );
  };

  const startConnect = (e: PointerEvent<HTMLSpanElement>, sourceId: string) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const targetAt = (p: Point) => {
      const hit = nodeAt(p, [...latest.current.byId.values()]);
      return hit && canAddDependency(latest.current.journey, hit.id, sourceId) ? hit.id : null;
    };
    const first = toGraph(e);
    setConnect({ sourceId, point: first, targetId: null });
    track(
      (ev) => {
        const p = toGraph(ev);
        setConnect({ sourceId, point: p, targetId: targetAt(p) });
      },
      (ev, cancelled) => {
        setConnect(null);
        const target = cancelled ? null : targetAt(toGraph(ev));
        if (target) latest.current.onConnect(sourceId, target);
      },
    );
  };

  const onNodeKey = (e: KeyboardEvent<HTMLDivElement>, id: string, stored: Point) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectEdge(null);
      onSelectModule(id);
      return;
    }
    const nudge: Record<string, Point> = {
      ArrowLeft: { x: -KEY_NUDGE, y: 0 },
      ArrowRight: { x: KEY_NUDGE, y: 0 },
      ArrowUp: { x: 0, y: -KEY_NUDGE },
      ArrowDown: { x: 0, y: KEY_NUDGE },
    };
    const d = nudge[e.key];
    if (!d) return;
    e.preventDefault();
    onMove(id, { x: stored.x + d.x, y: stored.y + d.y });
  };

  const connectStateOf = (id: string): ConnectState => {
    if (!connect || id === connect.sourceId) return "idle";
    return canAddDependency(journey, id, connect.sourceId) ? "valid" : "invalid";
  };

  const edges = (
    <>
      {journey.modules.flatMap((m) =>
        m.dependsOn.flatMap((dep) => {
          const from = byId.get(dep);
          const to = byId.get(m.id);
          if (!from || !to) return [];
          const id = edgeId(dep, m.id);
          const selected = id === selectedEdgeId;
          const d = edgePath(from, to);
          return [
            <g key={id}>
              <path
                d={d}
                fill="none"
                strokeWidth={selected ? 3 : 2}
                className={selected ? "stroke-destructive" : "stroke-os-container-hi"}
              />
              <path
                data-graph-edge
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={24}
                className="cursor-pointer"
                style={{ pointerEvents: "stroke" }}
                onClick={() => {
                  onSelectModule(null);
                  onSelectEdge(id);
                }}
              >
                <title>Select, then press Delete to remove</title>
              </path>
            </g>,
          ];
        }),
      )}
      {connect && byId.get(connect.sourceId) && (
        <path
          d={connectionPath(byId.get(connect.sourceId)!, connect.point)}
          fill="none"
          strokeWidth={2}
          className="stroke-os-accent"
        />
      )}
    </>
  );

  return (
    <GraphCanvas
      key={journey.id}
      boxes={fitBoxes}
      edges={edges}
      refitOnChange={false}
      viewRef={viewRef}
      label={`${journey.title || "Journey"} editor map`}
      className={cn(connect && "cursor-crosshair")}
      onPaneClick={() => {
        onSelectModule(null);
        onSelectEdge(null);
      }}
    >
      {journey.modules.map((m) => {
        const position = positionOf(m.id, m.position);
        return (
          <EditorModuleNode
            key={m.id}
            module={m}
            position={position}
            selected={m.id === selectedId}
            dragging={dragPos?.id === m.id}
            connectState={connectStateOf(m.id)}
            issueCount={issueCounts[m.id] ?? 0}
            measureRef={measure(m.id)}
            onBodyPointerDown={(e) => startDrag(e, m.id, m.position)}
            onHandlePointerDown={(e) => startConnect(e, m.id)}
            onKeyDown={(e) => onNodeKey(e, m.id, m.position)}
          />
        );
      })}
    </GraphCanvas>
  );
}
