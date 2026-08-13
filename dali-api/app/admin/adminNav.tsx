import {
  Activity,
  BarChart3,
  Clock,
  FileSignature,
  ClipboardCheck,
  Flag,
  Globe,
  Mail,
  Megaphone,
  Receipt,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import { ClusterHub } from "~/components/ClusterHub";
import type { FeatureFlagMap } from "~/lib/feature-flags";
import {
  clusterTrail,
  findCluster,
  type NavCluster,
  type NavSection,
  type NavSubtab,
} from "~/lib/cluster-nav";

// The Admin area is a nested hub: /admin groups its tools into clusters, each
// cluster carries its own short pill row, and consolidated tools (Email,
// Payroll) expose their views through an in-page sub-tab strip. This module is
// the single source of truth for that structure — the hub cards, the cluster
// hubs, the pill rows, and the sub-tabs all derive from ADMIN_CLUSTERS. The
// cluster/section/trail types and the card grid itself are shared with Core
// (app/lib/cluster-nav.ts, app/components/ClusterHub.tsx).
//
// Every cluster is uniformly Core-visible except Finance (Admin-only), so pill
// rows never need per-item role filtering — only the hub hides the Finance
// group from non-admins.
//
// Under the nav-regroup flag, People & Access and Communications leave Admin
// for the Core area (they are lab *process*, not system administration) — see
// adminClustersFor() and app/core/coreNav.tsx. They stay listed here so the
// flag-off nav is unchanged.

export type AdminSubtab = NavSubtab;
export type AdminSection = NavSection;
export type AdminCluster = NavCluster;

export type AdminClusterKey =
  | "people"
  | "communications"
  | "documents"
  | "finance"
  | "system";

// The clusters that move to Core when nav-regroup is on.
const CORE_OWNED_CLUSTERS: readonly AdminClusterKey[] = ["people", "communications"];

export const ADMIN_CLUSTERS: AdminCluster[] = [
  {
    key: "people",
    label: "People & Access",
    description: "Members, the roles they hold, domains, and attendance.",
    icon: Users,
    hubPath: "/admin/people",
    sections: [
      {
        key: "members",
        label: "Roles & Permissions",
        to: "/admin/members",
        icon: Shield,
        description: "Assign Admin, Core, and Domain Lead roles per term.",
      },
      {
        key: "domains",
        label: "Domains",
        to: "/admin/domains",
        icon: Globe,
        description: "The lab's domains, who leads them, and member eligibility.",
      },
      {
        key: "attendance",
        label: "Attendance",
        to: "/admin/attendance",
        icon: ClipboardCheck,
        description: "Self check-in events — who was invited and who checked in.",
      },
    ],
  },
  {
    key: "communications",
    label: "Communications",
    description: "Reach the lab and manage outbound email.",
    icon: Megaphone,
    hubPath: "/admin/communications",
    sections: [
      {
        key: "announcements",
        label: "Announcements",
        to: "/admin/announcements",
        icon: Megaphone,
        description:
          "Send an announcement to the lab, with an optional due date and attached form.",
      },
      {
        key: "email",
        label: "Email",
        to: "/admin/email-templates",
        icon: Mail,
        description:
          "Shared email templates and the Google accounts each area sends from.",
        subtabs: [
          { key: "email-templates", label: "Templates", to: "/admin/email-templates" },
          { key: "email-senders", label: "Senders", to: "/admin/email-senders" },
        ],
      },
    ],
  },
  {
    key: "documents",
    label: "Documents",
    description: "Agreements the lab issues and collects signatures on.",
    icon: FileSignature,
    hubPath: null,
    sections: [
      {
        key: "agreements",
        label: "Agreements",
        to: "/admin/agreements",
        icon: FileSignature,
        description:
          "Author agreements (membership, mentorship, confidentiality), place fields, and track signatories.",
      },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    description: "Payroll setup and TimesheetX reconciliation.",
    icon: Receipt,
    hubPath: null,
    adminOnly: true,
    sections: [
      {
        key: "payroll",
        label: "Payroll",
        to: "/admin/payroll-export",
        icon: Receipt,
        description:
          "Generate the per-term payroll export and reconcile TimesheetX actuals against DALI OS staffing.",
        subtabs: [
          { key: "payroll", label: "Hire Setup", to: "/admin/payroll-export" },
          { key: "payroll-reconcile", label: "Reconcile", to: "/admin/payroll" },
        ],
      },
    ],
  },
  {
    key: "system",
    label: "System & Insights",
    description: "Site usage, AI consumption, the audit log, and background jobs.",
    icon: Activity,
    hubPath: "/admin/system",
    sections: [
      {
        key: "analytics",
        label: "Analytics",
        to: "/admin/analytics",
        icon: BarChart3,
        description: "Site usage, pageview trends, and error rates.",
      },
      {
        key: "ai-usage",
        label: "AI Usage",
        to: "/admin/ai-usage",
        icon: Sparkles,
        description: "Per-member AI request and token usage.",
      },
      {
        key: "activity",
        label: "Activity",
        to: "/admin/activity",
        icon: Activity,
        description: "Audit log of admin actions across the site.",
      },
      {
        key: "jobs",
        label: "Jobs",
        to: "/admin/jobs",
        icon: Clock,
        description: "Background job status and controls — digests, reminders, scheduled sends.",
      },
      {
        key: "feature-flags",
        label: "Feature Flags",
        to: "/admin/feature-flags",
        icon: Flag,
        description: "Roll features out gradually — target everyone, specific roles, or named users.",
      },
    ],
  },
];

/**
 * The clusters Admin owns for one viewer. With nav-regroup on, the lab-process
 * clusters have moved to Core and Admin is strictly system-level; with it off,
 * Admin keeps everything it has today.
 */
export function adminClustersFor(
  flags: Partial<FeatureFlagMap> = {},
): AdminCluster[] {
  if (!flags["nav-regroup"]) return ADMIN_CLUSTERS;
  return ADMIN_CLUSTERS.filter((c) => !CORE_OWNED_CLUSTERS.includes(c.key as AdminClusterKey));
}

export function clusterByKey(key: string): AdminCluster | undefined {
  return findCluster(ADMIN_CLUSTERS, key);
}

export function adminTrail(active: string, isAdmin: boolean) {
  return clusterTrail({
    rootLabel: "Admin",
    rootPath: "/admin",
    clusters: ADMIN_CLUSTERS,
    active,
    isAdmin,
  });
}

// A route's `handle` opts into the admin trail: `export const handle =
// adminHandle("members")`. Reads the viewer's admin status from the route's
// loader data (`isAdmin`, or `viewerIsAdmin` on the pages that name it that way)
// to filter the Finance cluster out of the switcher for non-admins.
export function adminHandle(active: string) {
  return {
    // Admin pages open straight onto a title with no area subnav between it and
    // the trail, so the shell's default 8px gap left the two crowding each
    // other. The shell reads this flag rather than each page padding itself.
    roomyBreadcrumb: true,
    breadcrumbTrail: (data: unknown) => {
      const d = data as { isAdmin?: boolean; viewerIsAdmin?: boolean } | null;
      return adminTrail(active, !!d?.isAdmin || !!d?.viewerIsAdmin);
    },
  };
}

export function AdminClusterHub({ clusterKey }: { clusterKey: AdminClusterKey }) {
  return <ClusterHub cluster={clusterByKey(clusterKey)} />;
}
