import { useLocation, useNavigate } from "react-router";
import { Building2, Kanban } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";

const TABS = [
  { label: "Board", href: "/core/partners", icon: Kanban },
  { label: "Directory", href: "/core/partners/directory", icon: Building2 },
];

/** The Board / Directory switcher shared by both Partner CRM landing pages. */
export function PartnerCrmNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const items = TABS.map((tab) => ({
    label: tab.label,
    icon: tab.icon,
    active: pathname === tab.href,
    onClick: () => navigate(tab.href),
  }));
  return <SegmentedTabButtons label="Partner CRM" items={items} />;
}
