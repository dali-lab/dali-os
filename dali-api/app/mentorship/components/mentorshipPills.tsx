import { Heart, FileText } from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// Mentorship area's in-page subtab nav. Restores the Hub / Notes subtabs that
// used to live in the (now removed) nested sidebar — dev's flat sidebar surfaces
// per-area subtabs via AreaPillNav instead. Both are for any lab mentor or Core
// (the whole area is already gated by canViewMentorship server-side). Template
// management lives in a Core-only modal on the Notes subtab, not its own tab.
export function mentorshipPills(args: {
  active: "hub" | "browse";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/mentorship", active: args.active === "hub", icon: Heart },
    { label: "Mentorship notes", to: "/mentorship/browse", active: args.active === "browse", icon: FileText },
  ];
}
