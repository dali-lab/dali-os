import {
  Activity,
  BarChart3,
  Clock,
  Flag,
  Mail,
  Receipt,
  SendHorizonal,
  Sparkles,
} from "lucide-react";
import { ClusterHub } from "~/components/ClusterHub";
import {
  clusterTrail,
  findCluster,
  type NavCluster,
  type NavSection,
  type NavSubtab,
} from "~/lib/cluster-nav";

// The Admin area is a nested hub: /admin groups its tools into clusters, each
// cluster carries its own short pill row, and consolidated tools (Payroll)
// expose their views through an in-page sub-tab strip. This module is the
// single source of truth for that structure — the hub cards, the cluster hubs,
// the pill rows, and the sub-tabs all derive from ADMIN_CLUSTERS. The
// cluster/section/trail types and the card grid itself are shared with Core
// (app/lib/cluster-nav.ts, app/components/ClusterHub.tsx).
//
// Admin is strictly system-level: the lab *process* clusters (People & Access,
// Communications) live in the Core area (app/core/coreNav.tsx), and the email
// transport plumbing (Senders, the outbound outbox) sits under System &
// Insights here — process vs. system, one home per tool.
//
// Every cluster is Core-visible except Finance (Admin-only), so pill rows never
// need per-item role filtering — only the hub hides the Finance group from
// non-admins.

export type AdminSubtab = NavSubtab;
export type AdminSection = NavSection;
export type AdminCluster = NavCluster;

export type AdminClusterKey = "finance" | "system";

export const ADMIN_CLUSTERS: AdminCluster[] = [
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
    description:
      "Site usage, AI consumption, the audit log, background jobs, and the email transport.",
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
      {
        key: "email-senders",
        label: "Email Senders",
        to: "/admin/email-senders",
        icon: Mail,
        description:
          "The Gmail send-as account and daily cap backing each email purpose.",
      },
      {
        key: "outbound-messages",
        label: "Outbound Messages",
        to: "/admin/outbound-messages",
        icon: SendHorizonal,
        description:
          "Transactional outbox — inspect, retry, and cancel outbound email and Slack messages.",
      },
    ],
  },
];

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
