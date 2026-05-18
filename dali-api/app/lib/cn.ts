/**
 * Minimal className joiner. Filters out falsy values so callers can write
 * `cn("base", condition && "extra", className)`. No clsx/tailwind-merge
 * dependency — later classes already win via source order in our usage.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
