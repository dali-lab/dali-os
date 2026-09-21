import { describe, expect, it } from 'vitest'
import {
  isLandingBackgroundId,
  LANDING_BACKGROUND_IDS,
  LANDING_BACKGROUND_SCHEDULE,
  scheduledLandingBackground,
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
    expect(scheduledLandingBackground('2000-01-01')).toBe(first.id)
    for (const entry of rest) {
      expect(scheduledLandingBackground(entry.from)).toBe(entry.id)
    }
  })

  it('only accepts known ids for previews', () => {
    expect(isLandingBackgroundId('library')).toBe(true)
    expect(isLandingBackgroundId('nope')).toBe(false)
    expect(isLandingBackgroundId(null)).toBe(false)
  })
})
