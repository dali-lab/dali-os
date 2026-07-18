// Shared vibe vocabulary for mentor notes. A mentor's weekly read on a mentee:
// Good (green), Ok (yellow), Bad (red). Used by the note editor's picker and the
// browse grid's colored cells so the color/label mapping lives in one place.
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
    label: "Good",
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500",
  },
  Ok: {
    label: "So-so",
    dot: "bg-amber-400",
    pill: "bg-amber-400/15 text-amber-700 dark:text-amber-400 border-amber-400",
  },
  Bad: {
    label: "Bad",
    dot: "bg-red-500",
    pill: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500",
  },
};
