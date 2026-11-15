import { describe, expect, it } from 'vitest'
import {
  isLandingBackgroundId,
  LANDING_BACKGROUND_IDS,
  LANDING_BACKGROUND_SCHEDULE,
  landingWeek,
  scheduledLandingWeek,
} from '../schedule'

describe('landing background schedule', () => {
  it('is in date order and only names known backgrounds', () => {
    const dates = LANDING_BACKGROUND_SCHEDULE.map((entry) => entry.from)
    expect(dates).toEqual([...dates].sort())
    for (const entry of LANDING_BACKGROUND_SCHEDULE) {
      expect(entry.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(LANDING_BACKGROUND_IDS).toContain(entry.id)
    }
  })

  it('picks the latest entry that has started', () => {
    const [first, ...rest] = LANDING_BACKGROUND_SCHEDULE
    expect(scheduledLandingWeek('2000-01-01')).toBe(first)
    for (const entry of rest) {
      expect(scheduledLandingWeek(entry.from)).toBe(entry)
    }
  })

  it('only accepts known ids for previews', () => {
    expect(isLandingBackgroundId('library')).toBe(true)
    expect(isLandingBackgroundId('nope')).toBe(false)
    expect(isLandingBackgroundId(null)).toBe(false)
  })

  it('schedules every background, so each can be previewed with its title', () => {
    expect(new Set(LANDING_BACKGROUND_SCHEDULE.map((entry) => entry.id))).toEqual(new Set(LANDING_BACKGROUND_IDS))
  })

  it('previews another week with its own title', () => {
    const live = scheduledLandingWeek('2026-11-03')
    expect(live.id).toBe('bug-hunt')
    expect(landingWeek('2026-11-03', 'build')).toEqual({ id: 'build', title: 'Build', from: '2026-10-12' })
  })

  it('falls back to the live week for a missing or unknown preview', () => {
    const live = scheduledLandingWeek('2026-11-03')
    expect(landingWeek('2026-11-03', null)).toBe(live)
    expect(landingWeek('2026-11-03', 'nope')).toBe(live)
  })
})
