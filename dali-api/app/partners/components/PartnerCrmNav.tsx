import { BarChart3, Building2, CalendarRange, Kanban, RefreshCcw, UserPlus } from "lucide-react";
import type { SegmentedTab } from "~/components/ui/SegmentedTabs";

const TABS = [
  { label: "Applications", href: "/core/partners", icon: Kanban },
  { label: "Renewals", href: "/core/partners/renewals", icon: RefreshCcw },
  { label: "Planning", href: "/core/partners/planning", icon: CalendarRange },
  { label: "Directory", href: "/core/partners/directory", icon: Building2 },
  { label: "Referrals", href: "/core/partners/referrals", icon: UserPlus },
  { label: "Reports", href: "/core/partners/reports", icon: BarChart3 },
];

// Applications is matched exactly; it is a prefix of every other tab's path.
export function partnerCrmTabs(pathname: string): SegmentedTab[] {
  return TABS.map((tab) => ({
    label: tab.label,
    icon: tab.icon,
    href: tab.href,
    active: tab.href === "/core/partners" ? pathname === tab.href : pathname.startsWith(tab.href),
  }));
}
