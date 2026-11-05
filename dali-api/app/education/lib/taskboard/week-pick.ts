export type WeekPick = { start: number; end: number; next: "start" | "end" };

export function pickWeek(state: WeekPick, week: number): WeekPick {
  if (state.next === "start") return { start: week, end: week, next: "end" };
  return { start: Math.min(state.start, week), end: Math.max(state.start, week), next: "start" };
}

export function spanLabel(start: number, end: number): string {
  const weeks = end - start + 1;
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

export function defaultSpan(weekCount: number, week: number | null): { start: number; end: number } {
  if (week === null || week < 1 || week > weekCount) return { start: 1, end: Math.min(2, weekCount) };
  return { start: week, end: Math.min(weekCount, week + 1) };
}
