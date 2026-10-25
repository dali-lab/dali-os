import { useEffect, useMemo, useState } from "react";
import { getModuleStatus } from "~/journeys/lib/journey";
import type { Journey } from "~/journeys/lib/types";
import { GraphCanvas, useNodeHeights } from "./GraphCanvas";
import { edgePath, nodeBox } from "./graph-geometry";
import { ModuleNode } from "./ModuleNode";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** The learner's map: modules on their authored positions, prerequisites as edges. */
export function JourneyGraph({
  journey,
  completed,
  selectedId,
  onSelect,
}: {
  journey: Journey;
  completed: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (moduleId: string | null) => void;
}) {
  const { heights, measure } = useNodeHeights();
  const reducedMotion = usePrefersReducedMotion();
  const boxes = useMemo(
    () => journey.modules.map((m) => nodeBox(m.id, m.position, heights[m.id])),
    [journey.modules, heights],
  );
  const byId = useMemo(() => new Map(boxes.map((b) => [b.id, b])), [boxes]);

  const edges = journey.modules.flatMap((m) =>
    m.dependsOn.flatMap((dep) => {
      const from = byId.get(dep);
      const to = byId.get(m.id);
      if (!from || !to) return [];
      const done = completed.has(dep);
      const flowing = done && !completed.has(m.id) && !reducedMotion;
      return [
        <path
          key={`${dep}->${m.id}`}
          d={edgePath(from, to)}
          fill="none"
          strokeWidth={2}
          strokeDasharray={done && !flowing ? undefined : "6 6"}
          className={done ? "stroke-os-green" : "stroke-os-container-hi"}
        >
          {flowing && <animate attributeName="stroke-dashoffset" from="12" to="0" dur="0.6s" repeatCount="indefinite" />}
        </path>,
      ];
    }),
  );

  return (
    <GraphCanvas key={journey.id} boxes={boxes} edges={edges} onPaneClick={() => onSelect(null)} label={`${journey.title} map`}>
      {journey.modules.map((m) => (
        <ModuleNode
          key={m.id}
          module={m}
          status={getModuleStatus(m, completed)}
          selected={m.id === selectedId}
          onSelect={() => onSelect(m.id)}
          measureRef={measure(m.id)}
        />
      ))}
    </GraphCanvas>
  );
}
