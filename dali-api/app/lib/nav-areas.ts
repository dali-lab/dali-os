import {
  ArrowLeftRight,
  ArrowUpCircle,
  Award,
  BookOpen,
  Briefcase,
  ClipboardList,
  ClipboardPen,
  Clock,
  Files,
  FileText,
  FolderKanban,
  Gavel,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  Kanban,
  LayoutGrid,
  Mic,
  RotateCw,
  Settings,
  SlidersHorizontal,
  UserCheck,
  UserPlus,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { ADMIN_CLUSTERS } from "~/admin/adminNav";

// Single source of truth for the sidebar's "active area" dropdown and its
// vertical sub-tab children. Consolidates what used to be per-area *Pills.tsx
// factories and the inline pill arrays. The pinned trio (Home, My Tasks,
// Calendar) is rendered separately in Layout and is intentionally NOT an area
// here. Admin's children derive from ADMIN_CLUSTERS so its structure has one
// owner (app/admin/adminNav.tsx), not two.

// The role flags the layout already resolves and hands to <Layout>. Gates are
// expressed against these so the sidebar can filter areas + sub-tabs without
// any extra queries.
export type RoleFlags = {
  isCore: boolean;
  isAdmin: boolean;
  isDomainLead: boolean;
  isInterviewer: boolean;
  canViewForms: boolean;
  canViewStaffing: boolean;
  hasHiringAccess: boolean;
  isLabMentor: boolean;
  isInstructor: boolean;
};

export type SubTab = {
  label: string;
  href: string;
  icon: LucideIcon;
  // Omitted => always visible to anyone who can see the area.
  gate?: (r: RoleFlags) => boolean;
};

export type NavArea = {
  key: string;
  label: string;
  icon: LucideIcon;
  hubPath: string;
  // Whether the area appears in the dropdown at all. Omitted => always.
  gate?: (r: RoleFlags) => boolean;
  subtabs: SubTab[];
};

// Admin's five clusters as sub-tabs, derived (not duplicated) from
// ADMIN_CLUSTERS. Finance carries adminOnly; every other cluster is Core-visible.
const adminSubtabs: SubTab[] = [
  { label: "Hub", href: "/admin", icon: LayoutGrid },
  ...ADMIN_CLUSTERS.map((c) => ({
    label: c.label,
    href: c.hubPath ?? c.sections[0].to,
    icon: c.icon,
    gate: c.adminOnly ? (r: RoleFlags) => r.isAdmin : undefined,
  })),
];

// Order mirrors the former flat sidebar (navEntries) minus Calendar, which is
// now a pinned item. Sub-tabs + gates mirror the retired pill factories.
export const NAV_AREAS: NavArea[] = [
  {
    key: "projects",
    label: "Projects",
    icon: FolderKanban,
    hubPath: "/projects",
    subtabs: [
      { label: "Hub", href: "/projects", icon: LayoutGrid },
      { label: "Board", href: "/projects/staffing", icon: Kanban, gate: (r) => r.canViewStaffing },
      { label: "Intent to Work", href: "/projects/intent-to-work", icon: ClipboardPen, gate: (r) => r.canViewStaffing },
      { label: "Project Bids", href: "/projects/project-bids", icon: Gavel, gate: (r) => r.canViewStaffing },
      { label: "Level Up", href: "/projects/level-up", icon: ArrowUpCircle, gate: (r) => r.canViewStaffing },
      { label: "My Staffing", href: "/projects/my-staffing", icon: UserCheck },
    ],
  },
  {
    key: "members",
    label: "People",
    icon: UsersRound,
    hubPath: "/members",
    subtabs: [
      { label: "Hub", href: "/members", icon: LayoutGrid },
      { label: "Groups", href: "/members/groups", icon: UsersRound, gate: (r) => r.canViewForms },
    ],
  },
  {
    key: "internal-processes",
    label: "Lab Processes",
    icon: Workflow,
    hubPath: "/internal-processes",
    subtabs: [
      { label: "Hub", href: "/internal-processes", icon: LayoutGrid },
      { label: "Transfer", href: "/internal-processes/transfer", icon: ArrowLeftRight },
      { label: "JobX", href: "/internal-processes/jobx", icon: Briefcase },
    ],
  },
  {
    key: "mentorship",
    label: "Mentorship",
    icon: Heart,
    hubPath: "/mentorship",
    gate: (r) => r.isLabMentor || r.isCore,
    subtabs: [
      { label: "Hub", href: "/mentorship", icon: Heart },
      { label: "Mentorship notes", href: "/mentorship/browse", icon: FileText },
    ],
  },
  {
    key: "documents",
    label: "Documents",
    icon: FileText,
    hubPath: "/documents",
    subtabs: [],
  },
  {
    key: "education",
    label: "Education",
    icon: GraduationCap,
    hubPath: "/education",
    subtabs: [
      { label: "Hub", href: "/education", icon: LayoutGrid },
      { label: "Manage", href: "/education/manage", icon: SlidersHorizontal, gate: (r) => r.isCore || r.isInstructor },
      { label: "CE Compliance", href: "/education/compliance", icon: Award, gate: (r) => r.isCore },
    ],
  },
  {
    key: "partners",
    label: "Partners",
    icon: Handshake,
    hubPath: "/partners",
    subtabs: [
      { label: "Hub", href: "/partners", icon: LayoutGrid },
      { label: "Applications", href: "/partners/applications", icon: FileText },
    ],
  },
  {
    key: "hiring",
    label: "Hiring",
    icon: Briefcase,
    hubPath: "/hiring",
    gate: (r) => r.hasHiringAccess,
    subtabs: [
      { label: "Hub", href: "/hiring", icon: LayoutGrid },
      { label: "Reviews", href: "/hiring/reviewer", icon: ClipboardList },
      { label: "Interviews", href: "/hiring/interviews", icon: Mic, gate: (r) => r.isInterviewer },
      { label: "Applications", href: "/hiring/applications", icon: Files },
      { label: "Domain", href: "/hiring/domain-lead", icon: Globe, gate: (r) => r.isDomainLead },
      { label: "Cycles", href: "/hiring/lead", icon: RotateCw, gate: (r) => r.isCore },
      { label: "Waitlists", href: "/hiring/waitlists", icon: Clock, gate: (r) => r.isCore },
      { label: "Onboarding", href: "/hiring/onboarding", icon: UserPlus, gate: (r) => r.isCore },
      { label: "Library", href: "/hiring/library", icon: BookOpen, gate: (r) => r.isCore || r.isDomainLead || r.isAdmin },
    ],
  },
  {
    key: "forms",
    label: "Forms",
    icon: ClipboardList,
    hubPath: "/forms",
    gate: (r) => r.canViewForms,
    subtabs: [],
  },
  {
    key: "admin",
    label: "Admin",
    icon: Settings,
    hubPath: "/admin",
    gate: (r) => r.isCore,
    subtabs: adminSubtabs,
  },
];

// The area that owns a path: its hubPath equals the path or is a path-segment
// prefix of it. hubPaths never nest, so at most one matches.
export function areaForPath(path: string): NavArea | undefined {
  return NAV_AREAS.find(
    (a) => path === a.hubPath || path.startsWith(a.hubPath + "/"),
  );
}

// The sub-tab to highlight for a path within its area. The Hub tab (href ===
// hubPath) only matches an exact path so deeper surfaces don't light it up;
// every other tab matches its own subtree. Longest matching href wins so
// nested surfaces prefer the more specific tab.
export function activeSubtabHref(area: NavArea, path: string): string | undefined {
  let best: string | undefined;
  for (const t of area.subtabs) {
    const isHub = t.href === area.hubPath;
    const matches = isHub ? path === t.href : path === t.href || path.startsWith(t.href + "/");
    if (matches && (best === undefined || t.href.length > best.length)) best = t.href;
  }
  return best;
}

// True when the path is exactly a non-hub area sub-tab (e.g. /projects/staffing).
// Drives the breadcrumb favorite star: every sub-tab landing page is directly
// pinnable, using the same affordance as project/person/partner detail pages.
export function isAreaSubtabPath(path: string): boolean {
  return NAV_AREAS.some((a) =>
    a.subtabs.some((t) => t.href !== a.hubPath && t.href === path),
  );
}

export function visibleAreas(r: RoleFlags): NavArea[] {
  return NAV_AREAS.filter((a) => !a.gate || a.gate(r));
}

export function visibleSubtabs(area: NavArea, r: RoleFlags): SubTab[] {
  return area.subtabs.filter((t) => !t.gate || t.gate(r));
}
