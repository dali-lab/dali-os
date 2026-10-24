import { useLocation, useNavigate } from "react-router";
import { BarChart3, Building2, CalendarRange, Kanban } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";

const TABS = [
  { label: "Applications", href: "/core/partners", icon: Kanban },
  { label: "Plan", href: "/core/partners/plan", icon: CalendarRange },
  { label: "Directory", href: "/core/partners/directory", icon: Building2 },
  { label: "Reports", href: "/core/partners/reports", icon: BarChart3 },
];

/** The Applications / Plan / Directory / Reports switcher shared by the Partner
 *  CRM landing pages. Applications is matched exactly — it would otherwise be a
 *  prefix of every other tab's path too — the rest match by prefix so a
 *  future sub-path under them still reads as the right tab active. */
export function PartnerCrmNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const items = TABS.map((tab) => ({
    label: tab.label,
    icon: tab.icon,
    active:
      tab.href === "/core/partners" ? pathname === tab.href : pathname.startsWith(tab.href),
    onClick: () => navigate(tab.href),
  }));
  return <SegmentedTabButtons label="Partners" items={items} className="mb-4 self-start" />;
}
