import {
  Activity,
  BarChart3,
  Clock,
  FileSignature,
  ClipboardCheck,
  Globe,
  Mail,
  Megaphone,
  Receipt,
  Shield,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import type { Crumb } from "~/components/Breadcrumbs";

// The Admin area is a nested hub: /admin groups its tools into five clusters,
// each cluster carries its own short pill row, and consolidated tools (Email,
// Payroll) expose their views through an in-page sub-tab strip. This module is
// the single source of truth for that structure — the hub cards, the cluster
// hubs, the pill rows, and the sub-tabs all derive from ADMIN_CLUSTERS.
//
// Every cluster is uniformly Core-visible except Finance (Admin-only), so pill
// rows never need per-item role filtering — only the hub hides the Finance
// group from non-admins.

export type AdminSubtab = { key: string; label: string; to: string };

export type AdminSection = {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
  description: string;
  // Consolidated tools split one section into sibling views reached by an
  // in-page sub-tab strip. `to` points at the first (default) sub-tab.
  subtabs?: AdminSubtab[];
};

export type AdminClusterKey =
  | "people"
  | "communications"
  | "documents"
  | "finance"
  | "system";

export type AdminCluster = {
  key: AdminClusterKey;
  label: string;
  description: string;
  icon: LucideIcon;
  // A cluster hub page exists only where it groups more than one section;
  // single-section clusters link straight to their section from the hub.
  hubPath: string | null;
  adminOnly?: boolean;
  sections: AdminSection[];
};

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
    ],
  },
];

export function clusterByKey(key: string): AdminCluster | undefined {
  return ADMIN_CLUSTERS.find((c) => c.key === key);
}

// Admin's breadcrumb trail: Admin › Cluster ▾ › Section ▾ › [View ▾]. The
// cluster/section/view crumbs carry `siblings` so the shared Breadcrumbs renders
// them as dropdown switchers. Fed to the shared Breadcrumbs via each admin
// route's `handle.breadcrumbTrail` (see adminHandle). `active` is a section,
// sub-tab, or cluster key.
export function adminTrail(active: string, isAdmin: boolean): Crumb[] {
  const direct = clusterByKey(active);
  const found = direct ? null : resolve(active);
  const cluster = direct ?? found?.cluster;
  // /admin hub (or an unknown key): a lone "Admin" crumb — Breadcrumbs hides a
  // single-crumb trail, which is what we want on the hub itself.
  if (!cluster) return [{ label: "Admin", to: "/admin" }];

  const section = found?.section ?? null;
  const subtab = section?.subtabs?.find((s) => s.key === active) ?? null;

  const crumbs: Crumb[] = [
    { label: "Admin", to: "/admin" },
    {
      label: cluster.label,
      // Cluster switcher is access-filtered (Finance is Admin-only).
      siblings: ADMIN_CLUSTERS.filter((c) => isAdmin || !c.adminOnly).map((c) => ({
        label: c.label,
        to: c.hubPath ?? c.sections[0]!.to,
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

// A route's `handle` opts into the admin trail: `export const handle =
// adminHandle("members")`. Reads the viewer's admin status from the route's
// loader data (`isAdmin`, or `viewerIsAdmin` on the pages that name it that way)
// to filter the Finance cluster out of the switcher for non-admins.
export function adminHandle(active: string) {
  return {
    breadcrumbTrail: (data: unknown) => {
      const d = data as { isAdmin?: boolean; viewerIsAdmin?: boolean } | null;
      return adminTrail(active, !!d?.isAdmin || !!d?.viewerIsAdmin);
    },
  };
}

// Resolve an `active` key (a section key, a sub-tab key, or a cluster key) to
// the cluster + section it belongs to.
function resolve(active: string): { cluster: AdminCluster; section: AdminSection } | null {
  for (const cluster of ADMIN_CLUSTERS) {
    for (const section of cluster.sections) {
      if (section.key === active || section.subtabs?.some((s) => s.key === active)) {
        return { cluster, section };
      }
    }
  }
  return null;
}

// Shared cluster-hub body: a heading + a card per
// section. Used by the /admin/people, /admin/communications, /admin/system
// landing routes.
export function AdminClusterHub({ clusterKey }: { clusterKey: AdminClusterKey }) {
  const cluster = clusterByKey(clusterKey);
  if (!cluster) return null;
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {cluster.label}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{cluster.description}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cluster.sections.map((s) => (
          <Link
            key={s.key}
            to={s.to}
            className="bg-card border border-border shadow-brand-1 rounded-lg p-4 hover:border-accent-coral/60 hover:shadow-brand-2 transition-all"
          >
            <div className="flex items-center gap-2">
              <s.icon className="h-4 w-4 text-accent-coral shrink-0" aria-hidden />
              <h2 className="font-heading font-semibold text-foreground">{s.label}</h2>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
