import {
  Activity,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
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
import { Link, useRouteLoaderData } from "react-router";
import { useDismissableMenu } from "~/hooks/useDismissableMenu";
import { cn } from "~/lib/cn";

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

// A single crumb whose ▾ opens a menu of sibling destinations — the path bar's
// lateral-navigation affordance. Reuses the shared dismissable-menu hook
// (click-outside + Escape + ARIA).
function CrumbDropdown({
  label,
  items,
  currentKey,
}: {
  label: string;
  items: { key: string; label: string; to: string }[];
  currentKey: string;
}) {
  const { open, setOpen, ref } = useDismissableMenu();
  // A crumb with no siblings to switch to is just where you are — render it as
  // plain text, not an empty dropdown.
  if (items.length <= 1) {
    return (
      <span className="px-2 py-1 font-semibold font-heading text-foreground">
        {label}
      </span>
    );
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold font-heading text-foreground transition hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral"
      >
        {label}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[13rem] rounded-md border border-border bg-card py-1 shadow-lg"
        >
          {items.map((item) => (
            <Link
              key={item.key}
              to={item.to}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-sm transition hover:bg-muted/50",
                item.key === currentKey
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Check
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-accent-coral",
                  item.key === currentKey ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// The admin area's wayfinding: a compact path bar where each crumb is a
// dropdown. The trail gives depth + a way back up ("Admin" links to the hub);
// each ▾ switches to a sibling cluster or section. Renders in the pill row's
// old slot — pages keep handle.areaPills (which suppresses the site breadcrumb
// and zeroes the top padding). `active` is a section, sub-tab, or cluster key.
export function AdminPathBar({ active }: { active: string }) {
  const layout = useRouteLoaderData("routes/layout") as
    | { isAdmin?: boolean }
    | undefined;
  const isAdmin = layout?.isAdmin ?? false;

  if (active === "hub") return null;
  const direct = clusterByKey(active);
  const found = direct ? null : resolve(active);
  const cluster = direct ?? found?.cluster;
  if (!cluster) return null;
  const section = found?.section ?? null;
  // Consolidated sections (Email, Payroll) add a fourth crumb for the view.
  const subtab = section?.subtabs?.find((s) => s.key === active) ?? null;

  // Cluster switcher is access-filtered (Finance is Admin-only); sibling
  // sections within a cluster all share the cluster's access tier.
  const clusterItems = ADMIN_CLUSTERS.filter((c) => isAdmin || !c.adminOnly).map(
    (c) => ({ key: c.key, label: c.label, to: c.hubPath ?? c.sections[0]!.to }),
  );
  const sectionItems = cluster.sections.map((s) => ({
    key: s.key,
    label: s.label,
    to: s.to,
  }));
  const subtabItems =
    section?.subtabs?.map((s) => ({ key: s.key, label: s.label, to: s.to })) ??
    [];

  return (
    <nav
      aria-label="Breadcrumb"
      className="-mx-3 mb-6 border-b border-border sm:-mx-6 sm:mb-8 lg:-mx-10"
    >
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 text-sm sm:px-6 lg:px-10">
        <Link
          to="/admin"
          className="rounded-md px-2 py-1 font-semibold font-heading text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
        >
          Admin
        </Link>
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
          aria-hidden
        />
        <CrumbDropdown
          label={cluster.label}
          items={clusterItems}
          currentKey={cluster.key}
        />
        {section && (
          <>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
              aria-hidden
            />
            <CrumbDropdown
              label={section.label}
              items={sectionItems}
              currentKey={section.key}
            />
          </>
        )}
        {subtab && (
          <>
            <ChevronRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
              aria-hidden
            />
            <CrumbDropdown
              label={subtab.label}
              items={subtabItems}
              currentKey={subtab.key}
            />
          </>
        )}
      </div>
    </nav>
  );
}

// Shared cluster-hub body: the cluster's pill row + a heading + a card per
// section. Used by the /admin/people, /admin/communications, /admin/system
// landing routes.
export function AdminClusterHub({ clusterKey }: { clusterKey: AdminClusterKey }) {
  const cluster = clusterByKey(clusterKey);
  if (!cluster) return null;
  return (
    <div className="flex flex-col gap-4">
      <AdminPathBar active={clusterKey} />
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
