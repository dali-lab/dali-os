import { Heart, FileText } from "lucide-react";
import type { AreaPill } from "~/components/AreaPillNav";

// Mentorship area's in-page subtab nav. Restores the Hub / Notes subtabs that
// used to live in the (now removed) nested sidebar — dev's flat sidebar surfaces
// per-area subtabs via AreaPillNav instead. Area access is gated by
// canViewMentorship (lab mentor or Core/Admin); note lists are domain-scoped.
// Template management lives in a Core-only modal on the Notes subtab.
export function mentorshipPills(args: {
  active: "hub" | "browse";
}): AreaPill[] {
  return [
    { label: "Hub", to: "/mentorship", active: args.active === "hub", icon: Heart },
    { label: "Mentorship notes", to: "/mentorship/browse", active: args.active === "browse", icon: FileText },
  ];
}
