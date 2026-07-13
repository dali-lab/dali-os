import type { AreaPill } from "~/components/AreaPillNav";

// The Core staffing surfaces, rendered as an AreaPillNav on each page. These
// used to be four separate sidebar entries under Projects; the sidebar now
// carries "Staffing" alone and the pills carry the rest. Every page in the
// set is already canViewStaffing-gated, so all pills always show.
export function staffingPills(
  active: "board" | "intent" | "bids" | "level-up",
): AreaPill[] {
  return [
    { label: "Board", to: "/projects/staffing", active: active === "board" },
    { label: "Intent to Work", to: "/projects/intent-to-work", active: active === "intent" },
    { label: "Project Bids", to: "/projects/project-bids", active: active === "bids" },
    { label: "Level Up", to: "/projects/level-up", active: active === "level-up" },
  ];
}
