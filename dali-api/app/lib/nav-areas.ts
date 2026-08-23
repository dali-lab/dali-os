import {
  ArrowUpCircle,
  Award,
  BookOpen,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  Clock,
  Files,
  FileSignature,
  FileText,
  FolderKanban,
  Gavel,
  Globe,
  GraduationCap,
  Handshake,
  HardDrive,
  Heart,
  Kanban,
  LayoutGrid,
  Mic,
  RotateCw,
  Megaphone,
  Settings,
  Shield,
  SlidersHorizontal,
  Users,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { ADMIN_CLUSTERS, adminClustersFor } from "~/admin/adminNav";
import { CORE_CLUSTERS } from "~/core/coreNav";
import { clusterEntryPath } from "~/lib/cluster-nav";
import type { FeatureFlagMap } from "~/lib/feature-flags";

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
  // Hiring visibility under nav-regroup: Core/Admin/DomainLead always, plus a
  // regular member who reviews or interviews on a cycle that is live RIGHT NOW.
  // hasHiringAccess deliberately admits any-cycle reviewers forever; this does
  // not, so the tab disappears once a member's cycle closes.
  hasActiveHiringAccess: boolean;
  isLabMentor: boolean;
  isInstructor: boolean;
};

export type SubTab = {
  label: string;
  href: string;
  icon: LucideIcon;
  // Omitted => always visible to anyone who can see the area.
  gate?: (r: RoleFlags) => boolean;
  // Path subtree this tab owns for active-area / highlight matching, when its
  // `href` links elsewhere (e.g. an Agreements tab that deep-links into the
  // Drive but whose editor still lives under /admin/agreements). Defaults to
  // `href`.
  matchPrefix?: string;
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
      { label: "Staffing", href: "/projects/staffing", icon: Kanban, gate: (r) => r.canViewStaffing },
      { label: "Intent to Work", href: "/projects/intent-to-work", icon: ClipboardPen, gate: (r) => r.canViewStaffing },
      { label: "Project Bids", href: "/projects/project-bids", icon: Gavel, gate: (r) => r.canViewStaffing },
      { label: "Level Up", href: "/projects/level-up", icon: ArrowUpCircle, gate: (r) => r.canViewStaffing },
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
    key: "drive",
    label: "Drive",
    icon: HardDrive,
    hubPath: "/drive",
    subtabs: [
      { label: "Hub", href: "/drive", icon: LayoutGrid },
    ],
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
    key: "admin",
    label: "Admin",
    icon: Settings,
    hubPath: "/admin",
    gate: (r) => r.isCore,
    subtabs: adminSubtabs,
  },
];

// ---------------------------------------------------------------------------
// The nav-regroup area set.
//
// Five areas grouped by WHO a surface is for, not by what it is: regular
// members get General + Education (+ Hiring while they're on a live cycle),
// Core gets everything. Drive is not an area here at all — it is pinned under
// Calendar (see pinnedNavItems). Every Core process page keeps a working
// pre-regroup URL; the /core/* path is canonical only for flag-on viewers,
// which the source loaders enforce via regroupRedirect.
// ---------------------------------------------------------------------------

// Core's clustered tools as sub-tabs, derived (not duplicated) from
// CORE_CLUSTERS, exactly as Admin derives its own from ADMIN_CLUSTERS.
const coreClusterSubtabs: SubTab[] = CORE_CLUSTERS.map((c) => ({
  label: c.label,
  href: clusterEntryPath(c),
  icon: c.icon,
}));

const REGROUPED_AREAS: NavArea[] = [
  {
    key: "projects",
    label: "General",
    icon: FolderKanban,
    hubPath: "/projects",
    subtabs: [
      { label: "Projects", href: "/projects", icon: LayoutGrid },
      { label: "People", href: "/members", icon: UsersRound },
      // Groups' own pill row is hidden under the sidebar redesign, so without a
      // sub-tab here the page would be reachable only from ⌘K.
      { label: "Groups", href: "/members/groups", icon: Users, gate: (r) => r.canViewForms },
      { label: "Partners", href: "/partners", icon: Handshake },
      { label: "Mentorship", href: "/mentorship", icon: Heart, gate: (r) => r.isLabMentor || r.isCore },
    ],
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
    key: "core",
    label: "Core",
    icon: Shield,
    hubPath: "/core",
    gate: (r) => r.isCore,
    subtabs: [
      { label: "Hub", href: "/core", icon: LayoutGrid },
      { label: "Staffing", href: "/core/staffing", icon: Kanban },
      { label: "Intent to Work", href: "/core/intent-to-work", icon: ClipboardPen },
      { label: "Project Bids", href: "/core/project-bids", icon: Gavel },
      { label: "Level Up", href: "/core/level-up", icon: ArrowUpCircle },
      { label: "Roles & Permissions", href: "/core/access/roles", icon: Shield },
      { label: "Domains", href: "/core/access/domains", icon: Globe },
      ...coreClusterSubtabs,
      // Agreements left Admin's Documents cluster; it is lab process, not
      // system administration. Its URL stays /admin/agreements.
      { label: "Agreements", href: "/admin/agreements", icon: FileSignature },
      { label: "Attendance", href: "/core/attendance", icon: ClipboardCheck },
    ],
  },
  {
    key: "hiring",
    label: "Hiring",
    icon: Briefcase,
    hubPath: "/hiring",
    // Regular members see Hiring only while they are on a LIVE cycle, unlike
    // the flag-off gate which admits any-cycle reviewers forever.
    gate: (r) => r.hasActiveHiringAccess,
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
    key: "admin",
    label: "Admin",
    icon: Settings,
    hubPath: "/admin",
    gate: (r) => r.isCore,
    subtabs: [],
  },
];

// Admin's sub-tabs depend on the flag (People & Access + Communications move to
// Core), so they are resolved per viewer rather than baked into the array.
function adminSubtabsFor(flags: Partial<FeatureFlagMap>): SubTab[] {
  return [
    { label: "Hub", href: "/admin", icon: LayoutGrid },
    ...adminClustersFor(flags).map((c) => ({
      label: c.label,
      href: clusterEntryPath(c),
      icon: c.icon,
      gate: c.adminOnly ? (r: RoleFlags) => r.isAdmin : undefined,
    })),
  ];
}

// The card-grid lists for agreements and email templates are retired; their
// sidebar entries deep-link directly into the Drive folder. The rest of the
// area (editors, create action) stays intact.
function applyDriveSpacesSubstitutions(
  areas: NavArea[],
  agreementsConsole: boolean,
): NavArea[] {
  return areas.map((a) => {
    if (a.key !== "core") return a;
    return {
      ...a,
      subtabs: a.subtabs.map((t) => {
        // Core ▸ Agreements → Drive filtered to agreements, unless the console
        // flag keeps the dedicated /admin/agreements compliance page. The tab
        // keeps owning /admin/agreements for highlighting (its editor lives
        // there) even though the link now points at the Drive.
        if (t.href === "/admin/agreements")
          return agreementsConsole ? t : { ...t, href: "/drive?type=agreement", matchPrefix: t.href };
        // Core ▸ Communications email templates → Drive filtered to email templates.
        if (t.href === "/core/communications/email")
          return { ...t, href: "/drive?type=emailTemplate", matchPrefix: t.href };
        return t;
      }),
    };
  });
}

/** The area set for one viewer: regrouped when nav-regroup is on, else today's. */
export function areasFor(flags: Partial<FeatureFlagMap> = {}): NavArea[] {
  if (!flags["nav-regroup"]) return NAV_AREAS;
  const base = REGROUPED_AREAS.map((a) => {
    if (a.key === "admin") return { ...a, subtabs: adminSubtabsFor(flags) };
    return a;
  });
  // Deep-link agreements + email templates directly into Drive (agreements stays
  // on its console page when the agreements-console flag is on).
  return applyDriveSpacesSubstitutions(base, !!flags["agreements-console"]);
}

/**
 * The nav items pinned above the area dropdown. Home / My Tasks / Calendar are
 * rendered inline by Layout; this is the tail the flags decide. Drive is pinned
 * under nav-regroup; with the flag off it stays an area, exactly as it is today.
 */
export function pinnedNavItems(flags: Partial<FeatureFlagMap> = {}): SubTab[] {
  if (!flags["nav-regroup"]) return [];
  return [{ label: "Drive", href: "/drive", icon: HardDrive }];
}

// Both area sets at once. isAreaSubtabPath and the icon map are read from
// places with no flag context — the favorites star (FavoriteRouteButton), the
// favorites/recents glyphs (FavoriteIcon), and parseRouteHref server-side — so
// they must recognise a path that is a sub-tab on EITHER side of the flag.
// Favorites saved before the flag flips have to keep working after it.
const ALL_AREAS: NavArea[] = [...NAV_AREAS, ...REGROUPED_AREAS];

// These matchers are handed a live URL, not a bare pathname: in tab mode the
// sidebar tracks the focused tab, whose url keeps its query string (layout.tsx
// cleanUrl), and favorites are stored as `pathname + search`
// (FavoriteRouteButton). An area and its sub-tab are a function of the path
// alone, so trim the query/hash before matching — otherwise
// /projects/staffing?term=25F matches no sub-tab and drops the sidebar back to
// the bare area.
function pathnameOf(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

// A sub-tab can deep-link into a shared hub with a filter query — Core ▸
// Agreements points at /drive?type=agreement, and Core ▸ Communications' email
// templates at /drive?type=emailTemplate. Those pages live in the Drive but are
// owned by Core, so the bare /drive hub would otherwise win areaForPath by
// prefix and bounce the sidebar to Drive. A sub-tab whose href carries a query
// claims the exact filtered url instead: the path must match and every query
// param on the href must be present (extra params on the url are fine). Returns
// the full href length (query included) so the match ranks ABOVE the hub prefix;
// -1 when it doesn't apply or doesn't match.
function queryHrefMatchLen(url: string, href: string): number {
  const qi = href.indexOf("?");
  if (qi === -1) return -1;
  if (pathnameOf(url) !== href.slice(0, qi)) return -1;
  const want = new URLSearchParams(href.slice(qi + 1));
  const hashless = url.split("#")[0];
  const ui = hashless.indexOf("?");
  const have = new URLSearchParams(ui === -1 ? "" : hashless.slice(ui + 1));
  for (const [k, v] of want) if (have.get(k) !== v) return -1;
  return href.length;
}

// The area that owns a path. Two rules, in order:
//  1. an exact sub-tab href — the regrouped Projects area owns /members,
//     /partners and /mentorship, which are not under its hubPath at all, so
//     prefix matching alone would hand them to no area (or the wrong one);
//  2. otherwise the area whose hubPath is the path or a path-segment prefix.
// Longest match wins in both passes. Sub-tab subtrees (e.g. /members/:id) fall
// through to rule 2 via the borrowed area's own hubPath when it still exists,
// so ownedPrefixes covers those explicitly.
export function areaForPath(
  path: string,
  flags: Partial<FeatureFlagMap> = {},
): NavArea | undefined {
  const p = pathnameOf(path);
  const areas = areasFor(flags);

  let best: NavArea | undefined;
  let bestLen = -1;
  for (const a of areas) {
    for (const t of a.subtabs) {
      const match = t.matchPrefix ?? t.href;
      const matches = p === match || p.startsWith(match + "/");
      if (matches && match.length > bestLen) {
        best = a;
        bestLen = match.length;
      }
      // A query-scoped deep-link (e.g. /drive?type=agreement) is owned by this
      // sub-tab's area, not the hub its path belongs to.
      const qLen = queryHrefMatchLen(path, t.href);
      if (qLen > bestLen) {
        best = a;
        bestLen = qLen;
      }
    }
    const hubMatches = p === a.hubPath || p.startsWith(a.hubPath + "/");
    if (hubMatches && a.hubPath.length > bestLen) {
      best = a;
      bestLen = a.hubPath.length;
    }
  }
  return best;
}

// The sub-tab to highlight for a path within its area. The Hub tab (href ===
// hubPath) only matches an exact path so deeper surfaces don't light it up;
// every other tab matches its own subtree. Longest matching href wins so
// nested surfaces prefer the more specific tab.
export function activeSubtabHref(area: NavArea, path: string): string | undefined {
  const p = pathnameOf(path);
  let best: string | undefined;
  let bestLen = -1;
  for (const t of area.subtabs) {
    const isHub = t.href === area.hubPath;
    const match = t.matchPrefix ?? t.href;
    const matches = isHub ? p === t.href : p === match || p.startsWith(match + "/");
    if (matches && match.length > bestLen) {
      best = t.href;
      bestLen = match.length;
    }
    // Highlight a query-scoped deep-link (e.g. Core ▸ Agreements at
    // /drive?type=agreement) when the current url carries its filter, matching
    // areaForPath's ownership rule so the pill and the area agree.
    const qLen = queryHrefMatchLen(path, t.href);
    if (qLen > bestLen) {
      best = t.href;
      bestLen = qLen;
    }
  }
  return best;
}

// Is a pinned nav item (e.g. Drive, once regrouped) the owner of the current
// url? A pinned hub owns its pathname subtree — EXCEPT where a query-scoped area
// sub-tab claims the exact filtered url: Core ▸ Agreements lives at
// /drive?type=agreement but belongs to Core, so the Drive pin must NOT light up
// there. Handed a live url (pathname + search) like the other matchers, so the
// query is visible in tabless mode too (there `location.pathname` drops it).
export function isPinnedActive(
  path: string,
  href: string,
  flags: Partial<FeatureFlagMap> = {},
): boolean {
  const p = pathnameOf(path);
  if (p !== href && !p.startsWith(href + "/")) return false;
  // areaForPath returns an area only when a (query-scoped) sub-tab claims this
  // url; on a plain Drive url it's undefined, so the pin stays lit.
  return !areaForPath(path, flags);
}

/**
 * Does this page render its own horizontal nav row?
 *
 * Two independent signals, and the difference between them is where this kept
 * going wrong:
 *  - `areaSubnav` (e.g. calendar) renders its row unconditionally.
 *  - `areaPills` renders one only when the sidebar redesign is OFF; with the
 *    redesign on AreaPillNav returns null and there is no row at all.
 *
 * Anything that stands down "because the page has its own row" — the tabless
 * history arrows, the layout's flush top padding — has to ask this, or it
 * either doubles the row (areaSubnav read as no-row) or hides itself for a row
 * that isn't there (areaPills under the redesign).
 */
export function hasSubnavRow(
  matches: readonly { handle?: unknown }[],
  redesign: boolean,
): boolean {
  return matches.some((m) => {
    const h = m.handle as { areaSubnav?: boolean; areaPills?: boolean } | undefined;
    return Boolean(h?.areaSubnav || (!redesign && h?.areaPills));
  });
}

// True when the path is exactly a non-hub area sub-tab (e.g. /projects/staffing).
// Drives the breadcrumb favorite star: every sub-tab landing page is directly
// pinnable, using the same affordance as project/person/partner detail pages.
export function isAreaSubtabPath(path: string): boolean {
  const p = pathnameOf(path);
  return ALL_AREAS.some((a) =>
    a.subtabs.some((t) => t.href !== a.hubPath && t.href === p),
  );
}

// Flat href → icon lookup across every area hub and sub-tab. Lets the
// Favorites/Recent rows show a starred route's real area glyph instead of a
// generic compass. Built once at module load.
const HREF_ICONS: Record<string, LucideIcon> = (() => {
  const map: Record<string, LucideIcon> = {};
  for (const area of ALL_AREAS) {
    map[area.hubPath] = area.icon;
    for (const t of area.subtabs) map[t.href] = t.icon;
  }
  return map;
})();

/** The nav icon for a route href (hub or sub-tab), or null if it isn't one. */
export function iconForHref(href: string): LucideIcon | null {
  try {
    return HREF_ICONS[new URL(href, "http://local").pathname] ?? null;
  } catch {
    return null;
  }
}

export function visibleAreas(r: RoleFlags, flags: Partial<FeatureFlagMap> = {}): NavArea[] {
  return areasFor(flags).filter((a) => !a.gate || a.gate(r));
}

export function visibleSubtabs(area: NavArea, r: RoleFlags): SubTab[] {
  return area.subtabs.filter((t) => !t.gate || t.gate(r));
}
