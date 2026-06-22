import { Link } from "react-router";
import { ConnectionsGraph } from "~/components/ConnectionsGraph";
import type { ConnectionsResult, ConnEdge, EdgeType } from "~/lib/connections";

// Renders the radial graph above a grouped, accessible "Related" list. The
// list is the primary read path (complete within the fan-out cap); the graph
// is the at-a-glance overlay. Presentational only — the loader computes the
// ConnectionsResult and gates access.

const EDGE_LABEL: Record<EdgeType, string> = {
  declares_domain: "Domains",
  runs_in_term: "Terms",
  partnered_with: "Partners",
  assigned_to: "Project assignments",
  staffed_on: "Staffing",
  mentors: "Mentorship",
  eligible_in: "Domain eligibility",
  assigned_task: "Tasks",
  requests_role: "Role requests",
  contains: "Work items",
  tagged: "Tags",
};

const EDGE_ORDER: EdgeType[] = [
  "assigned_to",
  "staffed_on",
  "mentors",
  "eligible_in",
  "declares_domain",
  "requests_role",
  "runs_in_term",
  "partnered_with",
  "assigned_task",
  "contains",
  "tagged",
];

function metaSummary(meta: ConnEdge["meta"]): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.level != null) parts.push(String(meta.level));
  if (meta.status != null) parts.push(String(meta.status));
  if (meta.termCode != null) parts.push(String(meta.termCode));
  if (meta.domain != null) parts.push(String(meta.domain));
  if (meta.slots != null) parts.push(`${meta.slots} slots`);
  return parts.join(" · ");
}

export function ConnectionsPanel({
  data,
  standalone = false,
}: {
  data: ConnectionsResult;
  /** when false (embedded in a tab) the header is suppressed */
  standalone?: boolean;
}) {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));

  // Group edges by type, resolving each to "the other endpoint" relative to
  // the focus node so a row always names the connected entity.
  const groups = new Map<EdgeType, { node: (typeof data.nodes)[number]; summary: string }[]>();
  for (const e of data.edges) {
    const otherId = e.source === data.focus.id ? e.target : e.source;
    const other = nodeById.get(otherId);
    if (!other) continue;
    const list = groups.get(e.type) ?? [];
    list.push({ node: other, summary: metaSummary(e.meta) });
    groups.set(e.type, list);
  }

  const orderedTypes = EDGE_ORDER.filter((t) => groups.has(t));

  return (
    <div className="flex flex-col gap-4">
      {standalone && (
        <div>
          <h1 className="font-heading text-xl font-bold text-foreground">
            {data.focus.label}
          </h1>
          <p className="text-sm text-muted-foreground capitalize">
            {data.focus.type} connections
          </p>
        </div>
      )}

      {data.truncated && (
        <p className="text-xs text-muted-foreground bg-muted/50 border border-border rounded-md px-3 py-1.5">
          Some connections are capped for readability — the full set is in the
          related list below where available.
        </p>
      )}

      <div className="bg-card border border-border rounded-lg p-2 sm:p-4">
        <ConnectionsGraph nodes={data.nodes} edges={data.edges} />
      </div>

      <div className="flex flex-col gap-4">
        {orderedTypes.length === 0 && (
          <p className="text-sm text-muted-foreground">No related entities.</p>
        )}
        {orderedTypes.map((type) => {
          const rows = groups.get(type)!;
          return (
            <section key={type}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                {EDGE_LABEL[type]} ({rows.length})
              </h3>
              <ul className="flex flex-col gap-1">
                {rows.map((row, i) => (
                  <li key={`${row.node.id}-${i}`}>
                    {row.node.href ? (
                      <Link
                        to={row.node.href}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
                      >
                        <span className="text-foreground truncate">{row.node.label}</span>
                        {row.summary && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {row.summary}
                          </span>
                        )}
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                        <span className="text-foreground truncate">{row.node.label}</span>
                        {row.summary && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {row.summary}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
