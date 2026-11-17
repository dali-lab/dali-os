import { describe, expect, it } from 'vitest'
import { ROW, START_SPEED, SPEED_GAIN } from './course'
import { strobe } from './paint'

const TOP_SPEED = START_SPEED + SPEED_GAIN

describe('strobe', () => {
  it('leaves row seams alone at the starting speed', () => {
    expect(strobe(START_SPEED / 60, ROW)).toBe(0)
  })

  it('fully blurs row seams and sprocket holes at top speed on a 60Hz screen', () => {
    expect(strobe(TOP_SPEED / 60, ROW)).toBe(1)
    expect(strobe(TOP_SPEED / 60, ROW / 2)).toBe(1)
  })

  it('blurs less on a faster screen, where each frame moves less', () => {
    expect(strobe(TOP_SPEED / 120, ROW)).toBeLessThan(strobe(TOP_SPEED / 60, ROW))
  })

  it('rises with speed', () => {
    const mid = (START_SPEED + TOP_SPEED) / 2 / 60
    expect(strobe(mid, ROW)).toBeGreaterThan(0)
    expect(strobe(mid, ROW)).toBeLessThan(1)
  })

  it('is zero while paused', () => {
    expect(strobe(0, ROW / 2)).toBe(0)
  })
})
