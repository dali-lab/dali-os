import {
  BarChart3,
  Clock,
  Compass,
  Flag,
  Inbox,
  LayoutDashboard,
  Mail,
  Receipt,
  ScrollText,
  SendHorizonal,
  Server,
  ShieldBan,
  Sparkles,
  UserCog,
  Users,
} from "lucide-react";
import { NavLink, useRouteLoaderData } from "react-router";
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";
import { useFeatureFlags } from "~/components/FeatureFlags";
import { useOsChrome } from "~/components/os-chrome";
import { clusterTrail, type NavCluster, type NavSection } from "~/lib/cluster-nav";

// Admin is one sidebar entry per tool family ("section"), each with its tools as
// in-page tabs. A section is a NavCluster and its tabs are NavSections, so the
// breadcrumb trail, the command palette and the sidebar all read this one list.

export type AdminAlertKey = "messaging" | "platform";

export type AdminSection = Omit<NavCluster, "hubPath"> & {
  /** The section's own URL. It redirects to the first tab the viewer can open. */
  path: string;
  hubPath: string;
  alert?: AdminAlertKey;
};

const section = (s: Omit<AdminSection, "hubPath">): AdminSection => ({ ...s, hubPath: s.path });

export const ADMIN_OVERVIEW = {
  label: "Overview",
  path: "/admin",
  icon: LayoutDashboard,
  description: "What needs attention across DALI OS right now.",
};

export const ADMIN_SECTIONS: AdminSection[] = [
  section({
    key: "payroll",
    label: "Payroll",
    path: "/admin/payroll",
    description: "Set up the term's hires, then reconcile TimesheetX actuals against staffing.",
    icon: Receipt,
    adminOnly: true,
    sections: [
      { key: "hire-setup", label: "Hire setup", to: "/admin/payroll/hire-setup", icon: Receipt, description: "The per-term payroll export: project, Core, Instructor and Technigala hires." },
      { key: "reconcile", label: "Reconcile", to: "/admin/payroll/reconcile", icon: Receipt, description: "TimesheetX actuals against DALI OS staffing, by project and student." },
    ],
  }),
  section({
    key: "accounts",
    label: "Accounts",
    path: "/admin/accounts",
    description: "Every account on the site, support-mode sign-in, and who can reach it.",
    icon: UserCog,
    sections: [
      { key: "users", label: "Site users", to: "/admin/accounts/users", icon: Users, adminOnly: true, description: "Every account on the site. Log in as anyone for support and testing." },
      { key: "security", label: "Security", to: "/admin/accounts/security", icon: ShieldBan, description: "Blocked addresses and trusted networks for sign-in." },
    ],
  }),
  section({
    key: "messaging",
    label: "Messaging",
    path: "/admin/messaging",
    description: "The outbound email and Slack pipeline, and the accounts that send it.",
    icon: Mail,
    alert: "messaging",
    sections: [
      { key: "outbox", label: "Outbox", to: "/admin/messaging/outbox", icon: SendHorizonal, description: "Inspect, retry and cancel outbound email and Slack messages." },
      { key: "senders", label: "Senders & inboxes", to: "/admin/messaging/senders", icon: Inbox, description: "The Gmail account and daily cap behind each email purpose, and shared-inbox categories." },
    ],
  }),
  section({
    key: "insights",
    label: "Insights",
    path: "/admin/insights",
    description: "How the site is used, what AI costs, and who changed what.",
    icon: BarChart3,
    sections: [
      { key: "analytics", label: "Analytics", to: "/admin/insights/analytics", icon: BarChart3, description: "Site usage, pageview trends and errors." },
      { key: "ai-usage", label: "AI usage", to: "/admin/insights/ai-usage", icon: Sparkles, description: "AI requests, tokens and estimated cost per member." },
      { key: "audit-log", label: "Audit log", to: "/admin/insights/audit-log", icon: ScrollText, description: "Every admin action across the site." },
    ],
  }),
  section({
    key: "platform",
    label: "Platform",
    path: "/admin/platform",
    description: "Background jobs, the Fly.io and Neon fleet, and feature rollouts.",
    icon: Server,
    alert: "platform",
    sections: [
      { key: "jobs", label: "Jobs", to: "/admin/platform/jobs", icon: Clock, description: "Background job status and controls." },
      { key: "infrastructure", label: "Infrastructure", to: "/admin/platform/infrastructure", icon: Server, flag: "infra-dashboard", description: "The Fly.io and Neon fleet across lab projects." },
      { key: "flags", label: "Feature flags", to: "/admin/platform/flags", icon: Flag, description: "Roll features out to everyone, roles, or named people." },
    ],
  }),
  section({
    key: "onboarding",
    label: "Onboarding",
    path: "/admin/onboarding",
    description: "Time-boxed onboarding activities for new members.",
    icon: Compass,
    sections: [
      { key: "onboarding", label: "Onboarding", to: "/admin/onboarding", icon: Compass, description: "Author and run onboarding activities like the scavenger hunt." },
    ],
  }),
];

export function sectionByKey(key: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((s) => s.key === key);
}

export function canSeeSection(section: AdminSection, isAdmin: boolean): boolean {
  return isAdmin || !section.adminOnly;
}

export function visibleTabs(
  section: AdminSection,
  isAdmin: boolean,
  flags: Partial<Record<string, boolean>> = {},
): NavSection[] {
  if (!canSeeSection(section, isAdmin)) return [];
  return section.sections.filter((t) => (isAdmin || !t.adminOnly) && (!t.flag || flags[t.flag]));
}

/** Where a section's own URL lands this viewer: the first tab they can open. */
export function sectionLanding(
  section: AdminSection,
  isAdmin: boolean,
  flags: Partial<Record<string, boolean>> = {},
): string | null {
  return visibleTabs(section, isAdmin, flags)[0]?.to ?? null;
}

export function adminTrail(active: string, isAdmin: boolean) {
  // A single-tab section stops the trail at the section, so it never reads
  // "Onboarding › Onboarding".
  const single = ADMIN_SECTIONS.find((s) => s.sections.length === 1 && s.sections[0]!.key === active);
  return clusterTrail({
    rootLabel: "Admin",
    rootPath: "/admin",
    clusters: ADMIN_SECTIONS,
    active: single?.key ?? active,
    isAdmin,
  });
}

// A route's `handle` opts into the admin trail: `export const handle =
// adminHandle("jobs")`. Reads the viewer's admin status from the route's loader
// data (`isAdmin`, or `viewerIsAdmin` on the pages that name it that way).
export function adminHandle(active: string) {
  return {
    roomyBreadcrumb: true,
    breadcrumbTrail: (data: unknown) => {
      const d = data as { isAdmin?: boolean; viewerIsAdmin?: boolean } | null;
      return adminTrail(active, !!d?.isAdmin || !!d?.viewerIsAdmin);
    },
  };
}

/** The viewer's admin status from the app shell, for client-side tab gating. */
export function useViewerIsAdmin(): boolean {
  return !!useRouteLoaderData<{ isAdmin?: boolean }>("routes/layout")?.isAdmin;
}

/**
 * A section page's head: title, description, an actions slot, and the
 * section's tabs. Every admin page but the Overview opens with one.
 */
export function AdminSectionHeader({
  section: sectionKey,
  actions,
  title,
  description,
}: {
  section: string;
  actions?: ReactNode;
  /** Overrides the section label, for a detail page inside a section. */
  title?: ReactNode;
  description?: ReactNode;
}) {
  const { pageTitle, bodyText } = useOsChrome();
  const isAdmin = useViewerIsAdmin();
  const flags = useFeatureFlags();
  const section = sectionByKey(sectionKey);
  if (!section) return null;
  const tabs = visibleTabs(section, isAdmin, flags);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className={pageTitle}>{title ?? section.label}</h1>
          <p className={cn(bodyText, "mt-1.5 max-w-2xl")}>{description ?? section.description}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {tabs.length > 1 && (
        <nav aria-label={`${section.label} tools`} className="flex gap-7 overflow-x-auto border-b border-os-container">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={t.to}
              prefetch="intent"
              className={({ isActive }) =>
                cn(
                  "-mb-px whitespace-nowrap border-b-2 pb-3 text-[15px] transition-colors",
                  isActive
                    ? "border-os-accent font-semibold text-foreground"
                    : "border-transparent text-os-grey hover:text-foreground",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
