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
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500",
  },
  Ok: {
    label: "Room for improvement",
    dot: "bg-amber-400",
    pill: "bg-amber-400/15 text-amber-700 dark:text-amber-400 border-amber-400",
  },
  Bad: {
    label: "Concerning",
    dot: "bg-red-500",
    pill: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500",
  },
};
