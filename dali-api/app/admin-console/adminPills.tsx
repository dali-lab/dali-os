import type { AreaPill } from "~/components/AreaPillNav";

// The Admin area's tools (the sidebar entry is childless and lands on
// Roles & Permissions). Every admin page is already Core-gated, so the first
// three pills always show; the last three are Admin-only, matching the old
// sidebar section gates.
export function adminPills(args: {
  isAdmin: boolean;
  active:
    | "members"
    | "domains"
    | "announcements"
    | "activity"
    | "analytics"
    | "payroll";
}): AreaPill[] {
  return [
    {
      label: "Roles & Permissions",
      to: "/admin-console/members",
      active: args.active === "members",
    },
    { label: "Domains", to: "/admin-console/domains", active: args.active === "domains" },
    {
      label: "Announcements",
      to: "/admin-console/announcements",
      active: args.active === "announcements",
    },
    ...(args.isAdmin
      ? [
          {
            label: "Activity",
            to: "/admin-console/activity",
            active: args.active === "activity",
          },
          {
            label: "Analytics",
            to: "/admin-console/analytics",
            active: args.active === "analytics",
          },
          {
            label: "Payroll export",
            to: "/admin-console/payroll-export",
            active: args.active === "payroll",
          },
        ]
      : []),
  ];
}
