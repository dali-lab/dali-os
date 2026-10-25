export const RANGE_OPTIONS = [
  { key: "7d", days: 7, label: "7 days" },
  { key: "30d", days: 30, label: "30 days" },
  { key: "90d", days: 90, label: "90 days" },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];
export const DEFAULT_RANGE: RangeKey = "30d";

export function resolveRange(raw: string | null) {
  return RANGE_OPTIONS.find((r) => r.key === raw) ?? RANGE_OPTIONS[1];
}
