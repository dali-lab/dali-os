import type { LucideIcon } from "lucide-react";
import type { Crumb } from "~/components/Breadcrumbs";

// A nested area is a hub whose tools are grouped into clusters, each cluster
// carrying its own card grid, and consolidated tools exposing sibling views
// through an in-page sub-tab strip. Admin has always been shaped this way
// (app/admin/adminNav.tsx); Core now is too (app/core/coreNav.tsx), so the
// types, the trail builder, and the hub card grid live here with one owner
// instead of being copied per area.

export type NavSubtab = { key: string; label: string; to: string };

export type NavSection = {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
  description: string;
  // Consolidated tools split one section into sibling views reached by an
  // in-page sub-tab strip. `to` points at the first (default) sub-tab.
  subtabs?: NavSubtab[];
};

export type NavCluster = {
  key: string;
  label: string;
  description: string;
  icon: LucideIcon;
  // A cluster hub page exists only where it groups more than one section;
  // single-section clusters link straight to their section from the hub.
  hubPath: string | null;
  adminOnly?: boolean;
  sections: NavSection[];
};

/** Where a cluster's own entry points: its hub if it has one, else its lone section. */
export function clusterEntryPath(cluster: NavCluster): string {
  return cluster.hubPath ?? cluster.sections[0]!.to;
}

export function findCluster(
  clusters: readonly NavCluster[],
  key: string,
): NavCluster | undefined {
  return clusters.find((c) => c.key === key);
}

// Resolve an `active` key (a section key, a sub-tab key, or a cluster key) to
// the cluster + section it belongs to.
function resolve(
  clusters: readonly NavCluster[],
  active: string,
): { cluster: NavCluster; section: NavSection } | null {
  for (const cluster of clusters) {
    for (const section of cluster.sections) {
      if (section.key === active || section.subtabs?.some((s) => s.key === active)) {
        return { cluster, section };
      }
    }
  }
  return null;
}

/**
 * A nested area's breadcrumb trail: Root › Cluster ▾ › Section ▾ › [View ▾].
 * The cluster/section/view crumbs carry `siblings` so the shared Breadcrumbs
 * renders them as dropdown switchers. `active` is a section, sub-tab, or
 * cluster key; an unknown key (or the hub itself) yields a lone root crumb,
 * which Breadcrumbs hides — exactly what a hub page wants.
 */
export function clusterTrail(opts: {
  rootLabel: string;
  rootPath: string;
  clusters: readonly NavCluster[];
  active: string;
  isAdmin: boolean;
}): Crumb[] {
  const { rootLabel, rootPath, clusters, active, isAdmin } = opts;
  const direct = findCluster(clusters, active);
  const found = direct ? null : resolve(clusters, active);
  const cluster = direct ?? found?.cluster;
  if (!cluster) return [{ label: rootLabel, to: rootPath }];

  const section = found?.section ?? null;
  const subtab = section?.subtabs?.find((s) => s.key === active) ?? null;

  const crumbs: Crumb[] = [
    { label: rootLabel, to: rootPath },
    {
      label: cluster.label,
      // Cluster switcher is access-filtered (Finance is Admin-only).
      siblings: clusters
        .filter((c) => isAdmin || !c.adminOnly)
        .map((c) => ({
          label: c.label,
          to: clusterEntryPath(c),
          current: c.key === cluster.key,
        })),
    },
  ];
  if (section) {
    crumbs.push({
      label: section.label,
      siblings: cluster.sections.map((s) => ({
        label: s.label,
        to: s.to,
        current: s.key === section.key,
      })),
    });
  }
  if (subtab && section?.subtabs) {
    crumbs.push({
      label: subtab.label,
      siblings: section.subtabs.map((s) => ({
        label: s.label,
        to: s.to,
        current: s.key === active,
      })),
    });
  }
  return crumbs;
}
