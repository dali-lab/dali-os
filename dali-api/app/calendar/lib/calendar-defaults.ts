import type { WhDay } from "~/calendar/lib/types";

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
