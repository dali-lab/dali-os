import {
  Activity,
  BarChart3,
  Globe,
  LayoutGrid,
  Megaphone,
  Receipt,
  Shield,
  UserPlus,
} from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// The Admin area's tools (the sidebar entry is childless and lands on the
// hub). Every admin page is already Core-gated, so the first four pills
// always show; the last three are Admin-only, matching the old sidebar
// section gates.
export function adminPills(args: {
  isAdmin: boolean;
  active:
    | "hub"
    | "members"
    | "domains"
    | "announcements"
    | "activity"
    | "analytics"
    | "payroll"
    | "payroll-reconcile";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/admin-console", active: args.active === "hub", icon: LayoutGrid },
    {
      label: "Roles & Permissions",
      to: "/admin-console/members",
      active: args.active === "members",
      icon: Shield,
    },
    {
      label: "Domains",
      to: "/admin-console/domains",
      active: args.active === "domains",
      icon: Globe,
    },
    {
      label: "Announcements",
      to: "/admin-console/announcements",
      active: args.active === "announcements",
      icon: Megaphone,
    },
    ...(args.isAdmin
      ? [
          {
            label: "Activity",
            to: "/admin-console/activity",
            active: args.active === "activity",
            icon: Activity,
          },
          {
            label: "Analytics",
            to: "/admin-console/analytics",
            active: args.active === "analytics",
            icon: BarChart3,
          },
          {
            label: "Payroll: Hire Setup",
            to: "/admin-console/payroll-export",
            active: args.active === "payroll",
            icon: UserPlus,
          },
          {
            label: "Payroll: Reconcile",
            to: "/admin-console/payroll",
            active: args.active === "payroll-reconcile",
            icon: Receipt,
          },
        ]
      : []),
  ];
}
