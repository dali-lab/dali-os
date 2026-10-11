import type { WhDay, WhSegment } from "~/calendar/lib/types";

export const DEFAULT_BUFFER_MIN = 15;
export const DEFAULT_WORK_START_MIN = 9 * 60;
export const DEFAULT_WORK_END_MIN = 17 * 60;

export const EVENT_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;
export const DEFAULT_EVENT_DURATION_MIN = 60;

export function defaultWorkingHours(): WhDay[] {
  // Mon–Fri 9–5 InPerson, weekends disabled. The "default" segment lives only in
  // memory (no id) until the user persists it via the action handler.
  return Array.from({ length: 7 }).map((_, dow) => ({
    dayOfWeek: dow,
    segments:
      dow >= 1 && dow <= 5
        ? [
            {
              id: `default-${dow}`,
              startMinute: DEFAULT_WORK_START_MIN,
              endMinute: DEFAULT_WORK_END_MIN,
              location: "InPerson" as const,
            },
          ]
        : [],
  }));
}

export type WorkingHoursRow = {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  location: WhSegment["location"];
  enabled: boolean;
};

// Persisted WorkingHoursDay rows → the per-weekday shape the grids draw.
// Defaults only apply for users who have never persisted working hours. Once
// a user has any row (even disabled / mid-edit), the persisted state wins, so
// an explicit "disable Monday" sticks instead of being overwritten by the
// Mon–Fri 9–5 default on every reload.
export function assembleWorkingHours(rows: WorkingHoursRow[]): {
  workingHours: WhDay[];
  hasPersisted: boolean;
} {
  const byDow = new Map<number, WhSegment[]>();
  for (const r of rows) {
    // Disabled or inverted rows are treated as deleted by the UI.
    if (!r.enabled || r.startMinute >= r.endMinute) continue;
    const seg: WhSegment = {
      id: r.id,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      location: r.location,
    };
    const list = byDow.get(r.dayOfWeek);
    if (list) list.push(seg);
    else byDow.set(r.dayOfWeek, [seg]);
  }
  const hasPersisted = rows.length > 0;
  const workingHours = defaultWorkingHours().map((d) => {
    const persisted = byDow.get(d.dayOfWeek);
    if (persisted && persisted.length > 0) {
      persisted.sort((a, b) => a.startMinute - b.startMinute);
      return { dayOfWeek: d.dayOfWeek, segments: persisted };
    }
    if (hasPersisted) return { dayOfWeek: d.dayOfWeek, segments: [] };
    return d;
  });
  return { workingHours, hasPersisted };
}
