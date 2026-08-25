import {
  ClipboardPen,
  Gavel,
  Kanban,
  LayoutGrid,
} from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// The Projects area's surfaces as one flat pill row (the sidebar entry is
// childless and lands on the Hub). The four staffing surfaces are
// canViewStaffing-gated — members see the Hub only. Flat on
// purpose: a second-level row would replace this one on navigation, making
// the nav appear to vanish.
export function projectsPills(args: {
  canViewStaffing: boolean;
  active: "hub" | "staffing" | "intent" | "bids";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/projects", active: args.active === "hub", icon: LayoutGrid },
    ...(args.canViewStaffing
      ? [
          {
            label: "Staffing",
            to: "/projects/staffing",
            active: args.active === "staffing",
            icon: Kanban,
          },
          {
            label: "Intent to Work",
            to: "/projects/intent-to-work",
            active: args.active === "intent",
            icon: ClipboardPen,
          },
          {
            label: "Project Bids",
            to: "/projects/project-bids",
            active: args.active === "bids",
            icon: Gavel,
          },
        ]
      : []),
  ];
}
