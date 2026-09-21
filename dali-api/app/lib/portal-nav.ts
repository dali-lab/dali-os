import { Calendar, GraduationCap, Home, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// The non-member (Dartmouth student) shell's navigation, in one place so the
// rail, the mobile drawer and the ⌘K palette can't drift from each other.
//
// Unlike the member shell there is no area switcher: a student has four
// surfaces, and they are all reachable as direct rows. `matches` lists the
// other paths a row owns — /portal/apply and /portal/hiring are steps inside
// the Application row's surface, not rows of their own.

export interface PortalNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra path prefixes this row is the active one for. */
  matches?: string[];
}

export const PORTAL_NAV: PortalNavItem[] = [
  { label: "Home", href: "/portal", icon: Home },
  { label: "Calendar", href: "/portal/calendar", icon: Calendar },
  {
    label: "Application",
    href: "/portal/applications",
    icon: ScrollText,
    matches: ["/portal/apply", "/portal/application", "/portal/hiring"],
  },
  { label: "Education", href: "/portal/education", icon: GraduationCap },
];

/**
 * Whether `item` is the row the current path belongs to. `/portal` is the home
 * row and matches only itself — every other portal path starts with it, so a
 * prefix test there would light up Home on every page.
 */
export function isPortalNavActive(path: string, item: PortalNavItem): boolean {
  const cut = path.search(/[?#]/);
  const pathname = cut === -1 ? path : path.slice(0, cut);
  if (item.href === "/portal") return pathname === "/portal";
  const owns = [item.href, ...(item.matches ?? [])];
  return owns.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
