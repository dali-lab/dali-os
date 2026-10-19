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
  Good: {
    label: "Excellent",
    dot: "bg-os-green",
    pill: "bg-os-green/15 text-os-green border-os-green/40",
  },
  Ok: {
    label: "Room for improvement",
    dot: "bg-os-amber",
    pill: "bg-os-amber/15 text-os-amber border-os-amber/40",
  },
  Bad: {
    label: "Concerning",
    dot: "bg-destructive",
    pill: "bg-destructive/10 text-destructive border-destructive/40",
  },
};
