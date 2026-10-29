import { useLocation, useNavigate } from "react-router";
import { BarChart3, Building2, CalendarRange, Kanban, RefreshCcw } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { useFeatureFlag } from "~/components/FeatureFlags";

const TABS = [
  { label: "Applications", href: "/core/partners", icon: Kanban, flagged: false },
  { label: "Renewals", href: "/core/partners/renewals", icon: RefreshCcw, flagged: true },
  { label: "Planning", href: "/core/partners/planning", icon: CalendarRange, flagged: true },
  { label: "Directory", href: "/core/partners/directory", icon: Building2, flagged: false },
  { label: "Reports", href: "/core/partners/reports", icon: BarChart3, flagged: false },
];

/** The tab switcher shared by the Partner CRM pages. Each page puts it at the
 *  start of its one toolbar row. Applications is matched exactly; it would
 *  otherwise be a prefix of every other tab's path. */
export function PartnerCrmNav({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const planning = useFeatureFlag("partner-planning");
  const items = TABS.filter((tab) => planning || !tab.flagged).map((tab) => ({
    label: tab.label,
    icon: tab.icon,
    active:
      tab.href === "/core/partners" ? pathname === tab.href : pathname.startsWith(tab.href),
    onClick: () => navigate(tab.href),
  }));
  return <SegmentedTabButtons label="Partners" items={items} className={className ?? "self-start"} />;
}
