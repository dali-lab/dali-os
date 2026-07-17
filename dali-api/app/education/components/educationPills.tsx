import { Award, LayoutGrid, SlidersHorizontal } from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// The education area's top-level surfaces, rendered as an AreaPillNav on each
// landing page (the sidebar carries a single Education entry). Callers pass
// the viewer's role flags; the hub pill alone collapses to nothing inside
// AreaPillNav, so regular members see no pill row at all.
export function educationPills(args: {
  canManage: boolean;
  isCore: boolean;
  active: "hub" | "manage" | "compliance";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/education", active: args.active === "hub", icon: LayoutGrid },
    ...(args.canManage
      ? [
          {
            label: "Manage",
            to: "/education/manage",
            active: args.active === "manage",
            icon: SlidersHorizontal,
          },
        ]
      : []),
    ...(args.isCore
      ? [
          {
            label: "CE Compliance",
            to: "/education/compliance",
            active: args.active === "compliance",
            icon: Award,
          },
        ]
      : []),
  ];
}
