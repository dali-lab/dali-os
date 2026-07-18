import { Heart, FileText, LayoutTemplate } from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// Mentorship area's in-page subtab nav. Restores the Hub / Browse / Templates
// subtabs that used to live in the (now removed) nested sidebar — dev's flat
// sidebar surfaces per-area subtabs via AreaPillNav instead. Templates is
// Core-only; Hub + Browse are for any lab mentor or Core (the whole area is
// already gated by canViewMentorship server-side).
export function mentorshipPills(args: {
  isCore: boolean;
  active: "hub" | "browse" | "templates";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/mentorship", active: args.active === "hub", icon: Heart },
    { label: "Mentorship notes", to: "/mentorship/browse", active: args.active === "browse", icon: FileText },
    ...(args.isCore
      ? [
          {
            label: "Templates",
            to: "/mentorship/templates",
            active: args.active === "templates",
            icon: LayoutTemplate,
          },
        ]
      : []),
  ];
}
