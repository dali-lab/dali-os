import type { AreaPill } from "~/components/AreaPillNav";

// The hiring area's top-level surfaces as an AreaPillNav, mirroring the old
// sidebar sections' role gates (the sidebar now carries a single Hiring entry
// that lands on the /hiring hub). Emails stays inside Library's segmented row.
export function hiringPills(args: {
  isCore: boolean;
  isDomainLead: boolean;
  isAdmin: boolean;
  active:
    | "hub"
    | "reviews"
    | "applications"
    | "domain"
    | "cycles"
    | "waitlists"
    | "library";
}): AreaPill[] {
  const { isCore, isDomainLead, isAdmin, active } = args;
  return [
    { label: "Hub", to: "/hiring", active: active === "hub" },
    { label: "Reviews", to: "/hiring/reviewer", active: active === "reviews" },
    {
      label: "Applications",
      to: "/hiring/applications",
      active: active === "applications",
    },
    ...(isDomainLead
      ? [{ label: "Domain", to: "/hiring/domain-lead", active: active === "domain" }]
      : []),
    ...(isCore
      ? [
          { label: "Cycles", to: "/hiring/lead", active: active === "cycles" },
          { label: "Waitlists", to: "/hiring/waitlists", active: active === "waitlists" },
        ]
      : []),
    ...(isCore || isDomainLead || isAdmin
      ? [{ label: "Library", to: "/hiring/library", active: active === "library" }]
      : []),
  ];
}
