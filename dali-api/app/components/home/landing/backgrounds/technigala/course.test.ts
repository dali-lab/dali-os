import { describe, expect, it } from 'vitest'
import {
  AIR,
  createRun,
  isSupported,
  LANES,
  LEAD_ROWS,
  queueJump,
  ROW,
  rowAt,
  runBoost,
  runScore,
  speedAt,
  START_SPEED,
  stepRun,
  type Run,
  type RunEvent,
} from './course'
import { seededRandom } from './paint'

const seeded = seededRandom

const DT = 1 / 60

function play(run: Run, seconds: number, each?: (run: Run) => void) {
  const events: RunEvent[] = []
  for (let t = 0; t < seconds && run.phase !== 'over'; t += DT) {
    each?.(run)
    events.push(...stepRun(run, DT))
  }
  return events
}

/** Lay the course out as a run would meet it, with the speed it would have at each point. */
function layOut(seed: number, rows: number) {
  const run = createRun(seeded(seed))
  for (let i = 0; i < rows; i++) {
    run.d = Math.max(0, (i - 40) * ROW)
    run.speed = speedAt(run.d)
    rowAt(run, i)
  }
  return run.rows
}

describe('the tunnel course', () => {
  it('opens on solid floor', () => {
    const run = createRun(seeded(1))
    for (let i = 0; i < LEAD_ROWS; i++) expect(rowAt(run, i)).toEqual(Array(LANES).fill(true))
  })

  it('teaches a jump first: the first gap comes before any other obstacle', () => {
    const rows = layOut(2, 80)
    const firstHole = rows.findIndex((row) => row.includes(false))
    expect(rows[firstHole].every((tile) => !tile)).toBe(true)
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('never asks for a jump longer than a jump (seed %i)', (seed) => {
    const rows = layOut(seed, 3000)
    for (let i = 0; i < rows.length; ) {
      if (rows[i].some(Boolean)) {
        i++
        continue
      }
      let n = 0
      while (i + n < rows.length && !rows[i + n].some(Boolean)) n++
      const speed = speedAt(Math.max(0, (i - 40) * ROW))
      expect((n * ROW) / speed).toBeLessThan(AIR)
      // and there is a floor to land on
      if (i + n < rows.length) expect(rows[i + n].every(Boolean)).toBe(true)
      i += n
    }
  })

  it('mixes in every kind of piece after the opening', () => {
    const rows = layOut(9, 3000)
    const gaps = rows.filter((row, i) => !row.some(Boolean) && rows[i - 1]?.some(Boolean)).length
    const narrow = rows.filter((row) => row.filter(Boolean).length === 2).length
    const banded = rows.filter((row) => row.filter(Boolean).length === LANES - 3).length
    expect(gaps).toBeGreaterThan(5)
    expect(narrow).toBeGreaterThan(0)
    expect(banded).toBeGreaterThan(0)
  })
})

describe('a run', () => {
  it('starts slow and speeds up toward its cap', () => {
    expect(speedAt(0)).toBe(START_SPEED)
    expect(speedAt(400)).toBeGreaterThan(speedAt(100))
    expect(speedAt(100_000)).toBeLessThan(START_SPEED + 7.41)
  })

  it('scores four points a unit of distance', () => {
    const run = createRun(seeded(1))
    run.d = 10.3
    expect(runScore(run)).toBe(41)
  })

  it('reports how far into the speed-up it is', () => {
    const run = createRun(seeded(1))
    expect(runBoost(run)).toBe(0)
    run.speed = START_SPEED + 7.4
    expect(runBoost(run)).toBe(1)
  })

  it('ends in a fall at the first gap when nobody plays', () => {
    const run = createRun(seeded(3))
    const events = play(run, 20)
    expect(events).toContain('fall')
    expect(events.at(-1)).toBe('over')
    expect(run.phase).toBe('over')
    expect(runScore(run)).toBeGreaterThan(0)
  })

  it('clears the first gap with a jump', () => {
    const run = createRun(seeded(3))
    const firstHole = layOut(3, 80).findIndex((row) => row.includes(false))
    const events = play(run, 20, (r) => {
      const ahead = rowAt(r, Math.floor((r.d + r.speed * 0.12) / ROW))
      if (ahead && !ahead.some(Boolean)) queueJump(r)
      if (r.d > (firstHole + 20) * ROW) r.phase = 'over'
    })
    expect(events).toContain('jump')
    expect(events).toContain('land')
    expect(events).not.toContain('fall')
  })

  it('holds a runner straddling two lanes when either has floor', () => {
    const run = createRun(seeded(1))
    rowAt(run, 0)
    run.rows[0] = Array(LANES).fill(false)
    run.rows[0][1] = true
    run.th = 0.65 * ((Math.PI * 2) / LANES)
    expect(isSupported(run)).toBe(true)
    run.th = 0
    expect(isSupported(run)).toBe(false)
  })

  it('steers round the tunnel while a key is held', () => {
    const run = createRun(seeded(1))
    run.left = true
    play(run, 0.5)
    expect(run.th).toBeGreaterThan(0.5)
  })

  it('only jumps from the floor', () => {
    const run = createRun(seeded(1))
    queueJump(run)
    const first = stepRun(run, DT)
    expect(first).toContain('jump')
    queueJump(run)
    const again = stepRun(run, DT)
    expect(again).not.toContain('jump')
  })
})
