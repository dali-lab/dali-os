import { ClipboardCheck, Mail, Megaphone } from "lucide-react";
import { ClusterHub } from "~/components/ClusterHub";
import {
  clusterTrail,
  findCluster,
  type NavCluster,
} from "~/lib/cluster-nav";

// Core is the lab-*process* area introduced by the nav-regroup flag: the work
// Core members do to run the lab, split out from Projects (staffing, intent to
// work, bids, level up) and from Admin (access, attendance, communications), so
// Admin can be strictly system-level and Projects can be what regular members
// actually use.
//
// Only the clustered tools live here; the flat process pages (staffing, intent
// to work, project bids, level up) are plain Core sub-tabs declared in
// app/lib/nav-areas.ts. Structure, trail, and card grid mirror Admin's
// (app/admin/adminNav.tsx) through the shared app/lib/cluster-nav.ts.

export type CoreClusterKey = "communications";

export const CORE_CLUSTERS: NavCluster[] = [
  {
    key: "communications",
    label: "Communications",
    description: "Reach the lab and manage outbound email.",
    icon: Megaphone,
    hubPath: "/core/communications",
    sections: [
      {
        key: "announcements",
        label: "Announcements",
        to: "/core/communications/announcements",
        icon: Megaphone,
        description:
          "Send an announcement to the lab, with an optional due date and attached form.",
      },
      {
        key: "email",
        label: "Email",
        to: "/core/communications/email",
        icon: Mail,
        description:
          "Shared email templates and the Google accounts each area sends from.",
        subtabs: [
          { key: "email-templates", label: "Templates", to: "/core/communications/email" },
          { key: "email-senders", label: "Senders", to: "/core/communications/email-senders" },
        ],
      },
    ],
  },
];

// Core's flat sub-tabs — every page that is reached straight from the sidebar
// rather than through a cluster hub, so its trail is just "Core > <page>".
// Roles and Domains sit here rather than in an Access cluster: a two-page
// cluster only bought an extra hop between the sidebar and the page.
const STANDALONE_LABELS: Record<string, string> = {
  attendance: "Attendance",
  staffing: "Staffing",
  "intent-to-work": "Intent to Work",
  "project-bids": "Project Bids",
  "level-up": "Level Up",
  roles: "Roles & Permissions",
  domains: "Domains",
  agreements: "Agreements",
};

export const CORE_ATTENDANCE_ICON = ClipboardCheck;

export function coreClusterByKey(key: string): NavCluster | undefined {
  return findCluster(CORE_CLUSTERS, key);
}

export function coreTrail(active: string, isAdmin: boolean) {
  const standalone = STANDALONE_LABELS[active];
  if (standalone) {
    return [
      { label: "Core", to: "/core" },
      { label: standalone },
    ];
  }
  return clusterTrail({
    rootLabel: "Core",
    rootPath: "/core",
    clusters: CORE_CLUSTERS,
    active,
    isAdmin,
  });
}

/**
 * A /core route's `handle`: `export const handle = coreHandle("roles")`. The
 * alias route modules under app/core/routes/ set this instead of re-exporting
 * the source page's admin handle, which is the whole reason those aliases are
 * files rather than shared route ids.
 */
export function coreHandle(active: string) {
  return {
    roomyBreadcrumb: true,
    breadcrumbTrail: (data: unknown) => {
      const d = data as { isAdmin?: boolean; viewerIsAdmin?: boolean } | null;
      return coreTrail(active, !!d?.isAdmin || !!d?.viewerIsAdmin);
    },
  };
}

export function CoreClusterHub({ clusterKey }: { clusterKey: CoreClusterKey }) {
  return <ClusterHub cluster={coreClusterByKey(clusterKey)} />;
}
