import type { AreaPill } from "~/components/AreaPillNav";

// The Projects area's top-level surfaces (the sidebar entry is childless and
// lands on the Hub). The staffing sub-surfaces (Board / Intent to Work /
// Project Bids / Level Up) keep their own second-level row via staffingPills.
export function projectsPills(args: {
  canViewStaffing: boolean;
  active: "hub" | "staffing" | "my-staffing";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/projects", active: args.active === "hub" },
    ...(args.canViewStaffing
      ? [{ label: "Staffing", to: "/projects/staffing", active: args.active === "staffing" }]
      : []),
    {
      label: "My Staffing",
      to: "/projects/my-staffing",
      active: args.active === "my-staffing",
    },
  ];
}
