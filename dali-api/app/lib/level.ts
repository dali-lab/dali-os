export type Level = "P1" | "P2" | "P3";

export const ALL_LEVELS: readonly Level[] = ["P1", "P2", "P3"] as const;

export function isLevel(value: unknown): value is Level {
  return value === "P1" || value === "P2" || value === "P3";
}
