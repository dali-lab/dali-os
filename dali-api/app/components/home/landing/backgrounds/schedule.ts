/**
 * Which landing background and title Home shows, week by week. Every background stays in the repo;
 * the schedule only decides which one is live.
 *
 * To add next week's background:
 *   1. Put it in backgrounds/<id>/ with a default-exported component and its own CSS
 *      (scope anything that would clash with another background to
 *      `.landing[data-background='<id>']`).
 *   2. Add `<id>` to LANDING_BACKGROUND_IDS and its lazy import in LandingBackground.tsx.
 *   3. Add `{ id, title, from: 'YYYY-MM-DD' }` below. It goes live that day (viewer's time zone)
 *      and stays until a later entry starts.
 *
 * Preview any background before its date with `/?background=<id>`.
 */
export const LANDING_BACKGROUND_IDS = ['deep-space', 'library'] as const

export type LandingBackgroundId = (typeof LANDING_BACKGROUND_IDS)[number]

export type LandingWeek = { id: LandingBackgroundId; title: string; from: string }

export const LANDING_BACKGROUND_SCHEDULE: readonly LandingWeek[] = [
  { id: 'deep-space', title: 'Lab Kickoff', from: '2026-01-01' },
  { id: 'library', title: 'Research', from: '2026-09-21' },
]

export function isLandingBackgroundId(value: unknown): value is LandingBackgroundId {
  return LANDING_BACKGROUND_IDS.includes(value as LandingBackgroundId)
}

/** The week live on `today` (YYYY-MM-DD): the latest entry that has started. */
export function scheduledLandingWeek(today: string): LandingWeek {
  let current = LANDING_BACKGROUND_SCHEDULE[0]
  for (const entry of LANDING_BACKGROUND_SCHEDULE) {
    if (entry.from <= today) current = entry
  }
  return current
}
