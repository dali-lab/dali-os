import { useNavigate } from "react-router";
import {
  Briefcase,
  User as UserIcon,
  Layers,
  CalendarDays,
  Building2,
  ListChecks,
  Flag,
  Rocket,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { ConnNode, ConnEdge, NodeType } from "~/lib/connections";

// Pure presentational radial render. The focus node is centered; neighbors are
// grouped by node type and placed on concentric rings at evenly-spaced angles.
// Deterministic — no physics, no animation — so it stays a no-new-dependency
// plain-SVG view (see PR-09 "Rendering approach").

const NODE_ICON: Record<NodeType, LucideIcon> = {
  project: Briefcase,
  user: UserIcon,
  domain: Layers,
  term: CalendarDays,
  partner: Building2,
  epic: Flag,
  sprint: Rocket,
  task: ListChecks,
  tag: Tag,
};

// Tailwind-token colors per node type (fill for the disc, used as currentColor
// for the icon). Kept to the app's accent + neutral palette.
const NODE_COLOR: Record<NodeType, string> = {
  project: "var(--color-accent-coral, #ef6f5b)",
  user: "var(--color-accent-blue, #4f7cff)",
  domain: "var(--color-accent-violet, #8b5cf6)",
  term: "var(--color-muted-foreground, #6b7280)",
  partner: "var(--color-accent-green, #10b981)",
  epic: "var(--color-accent-amber, #f59e0b)",
  sprint: "var(--color-accent-amber, #f59e0b)",
  task: "var(--color-muted-foreground, #6b7280)",
  tag: "var(--color-muted-foreground, #6b7280)",
};

interface Positioned {
  node: ConnNode;
  x: number;
  y: number;
}

const SIZE = 520; // viewBox is square; SVG scales responsively
const CENTER = SIZE / 2;
const FOCUS_R = 26;
const NODE_R = 18;

// Deterministic ring layout: bucket neighbors by type, then lay each bucket on
// its own ring radius, fanning the nodes around the full circle.
function layout(nodes: ConnNode[]): Positioned[] {
  const focus = nodes.find((n) => n.isFocus) ?? nodes[0];
  if (!focus) return [];
  const neighbors = nodes.filter((n) => n.id !== focus.id);

  const byType = new Map<NodeType, ConnNode[]>();
  for (const n of neighbors) {
    const list = byType.get(n.type) ?? [];
    list.push(n);
    byType.set(n.type, list);
  }

  const positioned: Positioned[] = [{ node: focus, x: CENTER, y: CENTER }];

  const types = Array.from(byType.keys());
  const ringStep = (CENTER - NODE_R - 40) / Math.max(types.length, 1);
  // A continuous angle pointer so nodes across rings don't all stack at 12
  // o'clock; offsets each ring slightly for readability.
  types.forEach((type, ringIdx) => {
    const ring = byType.get(type)!;
    const radius = 90 + ringStep * ringIdx;
    const angleStep = (Math.PI * 2) / ring.length;
    const angleOffset = (ringIdx * Math.PI) / 6;
    ring.forEach((node, i) => {
      const angle = angleOffset + angleStep * i - Math.PI / 2;
      positioned.push({
        node,
        x: CENTER + radius * Math.cos(angle),
        y: CENTER + radius * Math.sin(angle),
      });
    });
  });

  return positioned;
}

function truncateLabel(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export function ConnectionsGraph({
  nodes,
  edges,
}: {
  nodes: ConnNode[];
  edges: ConnEdge[];
}) {
  const navigate = useNavigate();
  const positioned = layout(nodes);
  const pos = new Map(positioned.map((p) => [p.node.id, p]));

  if (positioned.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No connections to display.
      </p>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-full h-auto max-h-[520px]"
      role="img"
      aria-label="Entity connections graph"
    >
      {/* edges first so they sit behind the nodes */}
      <g stroke="var(--color-border, #d1d5db)" strokeWidth={1.5}>
        {edges.map((e, i) => {
          const s = pos.get(e.source);
          const t = pos.get(e.target);
          if (!s || !t) return null;
          return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} />;
        })}
      </g>

      {positioned.map(({ node, x, y }) => {
        const Icon = NODE_ICON[node.type];
        const r = node.isFocus ? FOCUS_R : NODE_R;
        const color = NODE_COLOR[node.type];
        const clickable = Boolean(node.href);
        return (
          <g
            key={node.id}
            transform={`translate(${x} ${y})`}
            className={clickable ? "cursor-pointer" : undefined}
            onClick={clickable ? () => navigate(node.href!) : undefined}
            role={clickable ? "link" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={
              clickable
                ? (ev) => {
                    if (ev.key === "Enter" || ev.key === " ") navigate(node.href!);
                  }
                : undefined
            }
            aria-label={`${node.type}: ${node.label}`}
          >
            <circle
              r={r}
              fill={color}
              fillOpacity={node.isFocus ? 1 : 0.18}
              stroke={color}
              strokeWidth={node.isFocus ? 2.5 : 1.5}
            />
            <Icon
              x={-9}
              y={-9}
              width={18}
              height={18}
              color={node.isFocus ? "#fff" : color}
            />
            <text
              y={r + 14}
              textAnchor="middle"
              className="fill-foreground"
              fontSize={11}
              fontWeight={node.isFocus ? 600 : 400}
            >
              {truncateLabel(node.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
