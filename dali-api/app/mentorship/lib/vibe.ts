// Shared vibe vocabulary for mentor notes. The stored enum values remain
// stable while the user-facing labels live here for the editor and browse grid.
export type Vibe = "Good" | "Ok" | "Bad";

export const VIBES: Vibe[] = ["Good", "Ok", "Bad"];

export const VIBE_META: Record<
  Vibe,
  {
    label: string;
    // Solid swatch for a filled grid cell.
    dot: string;
    // Text + subtle background for the editor's selected pill.
    pill: string;
  }
> = {
  // Fixed pastel fills, not the os-green/amber/red tokens: those resolve to
  // deep ink shades in light mode, and a solid dot should stay pastel in both
  // themes.
  Good: {
    label: "Excellent",
    dot: "bg-[#9fe0a8]",
    pill: "bg-os-green/15 text-os-green border-os-green/40",
  },
  Ok: {
    label: "Room for improvement",
    dot: "bg-[#f2b84b]",
    pill: "bg-os-amber/15 text-os-amber border-os-amber/40",
  },
  Bad: {
    label: "Concerning",
    dot: "bg-[#ff6b6b]",
    pill: "bg-os-red/15 text-os-red border-os-red/40",
  },
};
