import type { AreaPill } from "~/components/AreaPillNav";

// The education area's top-level surfaces, rendered as an AreaPillNav on each
// landing page (the sidebar carries a single Education entry). Callers pass
// the viewer's role flags; the browse pill alone collapses to nothing inside
// AreaPillNav, so regular members see no pill row at all.
export function educationPills(args: {
  canManage: boolean;
  isCore: boolean;
  active: "browse" | "manage" | "compliance";
}): AreaPill[] {
  return [
    { label: "Browse", to: "/education", active: args.active === "browse" },
    ...(args.canManage
      ? [{ label: "Manage", to: "/education/manage", active: args.active === "manage" }]
      : []),
    ...(args.isCore
      ? [
          {
            label: "CE Compliance",
            to: "/education/compliance",
            active: args.active === "compliance",
          },
        ]
      : []),
  ];
}
