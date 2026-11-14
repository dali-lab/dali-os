/*
 * The tunnel run: twelve lanes of film strip wrapped into a tube, scrolling toward the runner. This
 * module is the game without any drawing, so the rules can be tested on their own.
 *
 * Course pieces are sized in seconds rather than rows, so they stay fair as the run speeds up. The
 * numbers were tuned by simulated play: every generated course has a way through, a casual player
 * lasts about half a minute and a skilled one about a minute.
 */

export const LANES = 12
export const LANE_ANGLE = (Math.PI * 2) / LANES
export const ROW = 0.5
export const JUMP_V = 3
export const GRAVITY = 10
export const AIR = (2 * JUMP_V) / GRAVITY
export const START_SPEED = 3.1
export const SPEED_GAIN = 7.4
export const LEAD_ROWS = 14
const STEER_RATE = 3.1
const JUMP_BUFFER = 0.14
const FALL_TIME = 1.1
const TRAIL_LENGTH = 2.4

const INTRO = ['gap', 'strip', 'holes', 'gap', 'spiral'] as const
export type Piece = (typeof INTRO)[number]

export type RunPhase = 'play' | 'fall' | 'over'
export type RunEvent = 'jump' | 'land' | 'fall' | 'over'

export type Run = {
  phase: RunPhase
  /** Distance travelled down the tunnel. */
  d: number
  /** The runner's angle round the tunnel, and how fast it is changing. */
  th: number
  thv: number
  /** Height above the floor while jumping. */
  y: number
  vy: number
  speed: number
  rows: boolean[][]
  pending: boolean[][]
  /** The piece each row belongs to, null for plain floor. */
  kinds: (Piece | null)[]
  pendingKinds: (Piece | null)[]
  /** Seconds of play so far. */
  t: number
  /** The piece the runner fell through, once they have. */
  endedOn: Piece | null
  safeLane: number
  pieces: number
  left: boolean
  right: boolean
  /** Drag steering from a pointer, -1 to 1. */
  steer: number
  jumpBuffer: number
  fallZ: number
  fallV: number
  fallT: number
  trail: { d: number; th: number; y: number }[]
  random: () => number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const lane = (l: number) => ((l % LANES) + LANES) % LANES
const ringDistance = (a: number, b: number) => Math.min(lane(a - b), lane(b - a))

export function speedAt(d: number) {
  return START_SPEED + SPEED_GAIN * (1 - Math.exp(-d / 420))
}

export function createRun(random: () => number = Math.random): Run {
  return {
    phase: 'play',
    d: 0,
    th: 0,
    thv: 0,
    y: 0,
    vy: 0,
    speed: START_SPEED,
    rows: [],
    pending: [],
    kinds: [],
    pendingKinds: [],
    t: 0,
    endedOn: null,
    safeLane: 0,
    pieces: 0,
    left: false,
    right: false,
    steer: 0,
    jumpBuffer: 0,
    fallZ: 0,
    fallV: 0,
    fallT: 0,
    trail: [],
    random,
  }
}

export function runScore(run: Run) {
  return Math.floor(run.d * 4)
}

/** How far the run is into its speed-up, 0 to 1. */
export function runBoost(run: Run) {
  return clamp((run.speed - START_SPEED) / SPEED_GAIN, 0, 1)
}

export function queueJump(run: Run) {
  run.jumpBuffer = JUMP_BUFFER
}

function planPiece(run: Run) {
  const { random } = run
  const diff = clamp(run.d / 400, 0, 1)
  const rowsPerSecond = run.speed / ROW
  const full = () => Array<boolean>(LANES).fill(true)
  const add = (row: boolean[]) => run.pending.push(row)
  const floor = (seconds: number) => {
    const n = Math.max(1, Math.ceil(seconds * rowsPerSecond))
    for (let k = 0; k < n; k++) add(full())
  }

  floor(lerp(1.1, 0.5, diff))
  const rowsPerLane = Math.max(2, Math.round(rowsPerSecond / lerp(0.6, 1.4, diff)))
  run.pieces += 1
  const kind: Piece = INTRO[run.pieces - 1] ?? pickPiece(random())
  const pieceStart = run.pending.length

  if (kind === 'holes') {
    const n = Math.round(lerp(2, 3.5, random()) * rowsPerSecond)
    const start = run.pending.length
    for (let k = 0; k < n; k++) add(full())
    const path: number[] = []
    let safe = run.safeLane
    for (let k = 0; k < n; k++) {
      if (k % rowsPerLane === rowsPerLane - 1 && random() < 0.5) safe = lane(safe + (random() < 0.5 ? -1 : 1))
      path.push(safe)
    }
    const blocks = Math.round((n / rowsPerSecond) * lerp(1.2, 4.5, diff))
    for (let b = 0; b < blocks; b++) {
      const length = Math.max(2, Math.round(rowsPerSecond * lerp(0.22, 0.5, random())))
      const width = 1 + Math.floor(random() * 3)
      const r0 = Math.floor(random() * Math.max(1, n - length))
      const l0 = Math.floor(random() * LANES)
      for (let k = r0; k < Math.min(n, r0 + length); k++) {
        for (let x = 0; x < width; x++) {
          const l = lane(l0 + x)
          if (ringDistance(l, path[k]) > 0) run.pending[start + k][l] = false
        }
      }
    }
    run.safeLane = path[n - 1]
  } else if (kind === 'gap') {
    const n = Math.max(1, Math.round(AIR * lerp(0.3, 0.55, diff) * lerp(0.75, 1, random()) * rowsPerSecond))
    for (let k = 0; k < n; k++) add(Array<boolean>(LANES).fill(false))
    floor(AIR * 1.15)
  } else if (kind === 'strip') {
    const wide = diff < 0.8
    for (let half = LANES / 2; half > (wide ? 1 : 0.5); half -= 1 / rowsPerLane) {
      const h = half
      add(Array.from({ length: LANES }, (_, l) => ringDistance(l, run.safeLane) <= h))
    }
    const n = Math.round(lerp(2, 4, random()) * rowsPerSecond)
    const dir = random() < 0.5 ? 1 : -1
    for (let k = 0; k < n; k++) {
      if (k > 0 && k % rowsPerLane === 0) run.safeLane = lane(run.safeLane + dir)
      add(
        Array.from({ length: LANES }, (_, l) => {
          const dl = lane(l - run.safeLane)
          return dl === 0 || dl === 1 || (wide && dl === LANES - 1)
        }),
      )
    }
  } else {
    // A band of missing film turning slowly round the tunnel: outrun it or jump across.
    const n = Math.round(lerp(2, 3, random()) * rowsPerSecond)
    const dir = random() < 0.5 ? 1 : -1
    const sweep = lerp(1.6, 3, diff)
    const from = run.safeLane + 4
    for (let k = 0; k < n; k++) {
      const at = from + dir * Math.floor((k / rowsPerSecond) * sweep)
      add(Array.from({ length: LANES }, (_, l) => lane(l - at) >= 3))
    }
  }
  for (let k = run.pendingKinds.length; k < run.pending.length; k++) run.pendingKinds.push(k >= pieceStart ? kind : null)
}

function pickPiece(r: number): Piece {
  if (r < 0.28) return 'holes'
  if (r < 0.52) return 'gap'
  if (r < 0.8) return 'strip'
  return 'spiral'
}

/** Row `i` of the course, generated on first use. */
export function rowAt(run: Run, i: number): boolean[] | null {
  if (i < 0) return null
  while (run.rows.length <= i) {
    if (run.rows.length < LEAD_ROWS) {
      run.rows.push(Array<boolean>(LANES).fill(true))
      run.kinds.push(null)
    } else {
      if (!run.pending.length) planPiece(run)
      run.rows.push(run.pending.shift() as boolean[])
      run.kinds.push(run.pendingKinds.shift() ?? null)
    }
  }
  return run.rows[i]
}

/** Whether there is film under the runner. A runner straddling two lanes is held up by either. */
export function isSupported(run: Run) {
  const row = rowAt(run, Math.floor(run.d / ROW))
  const f = run.th / LANE_ANGLE
  const l = Math.round(f)
  if (!row || row[lane(l)]) return true
  const off = f - l
  return Math.abs(off) > 0.3 && row[lane(off > 0 ? l + 1 : l - 1)]
}

export function stepRun(run: Run, dt: number): RunEvent[] {
  const events: RunEvent[] = []
  if (run.phase === 'play') {
    run.t += dt
    run.speed = speedAt(run.d)
    const steer = clamp((run.left ? 1 : 0) - (run.right ? 1 : 0) + run.steer, -1, 1)
    run.thv += (steer * STEER_RATE - run.thv) * Math.min(1, dt * 12)
    run.th += run.thv * dt
    run.d += run.speed * dt
    if (run.jumpBuffer > 0) {
      run.jumpBuffer -= dt
      if (run.y === 0 && isSupported(run)) {
        run.vy = JUMP_V
        run.jumpBuffer = 0
        events.push('jump')
      }
    }
    if (run.y > 0 || run.vy > 0) {
      run.vy -= GRAVITY * dt
      run.y = Math.max(0, run.y + run.vy * dt)
      if (run.y === 0) {
        run.vy = 0
        events.push('land')
      }
    }
    if (run.y === 0 && !isSupported(run)) {
      run.phase = 'fall'
      run.endedOn = run.kinds[Math.floor(run.d / ROW)] ?? null
      run.fallV = 0.4
      events.push('fall')
    }
    run.trail.push({ d: run.d, th: run.th, y: run.y })
  } else if (run.phase === 'fall') {
    run.fallT += dt
    run.fallV += 7 * dt
    run.fallZ += run.fallV * dt
    run.d += run.speed * 0.5 * dt
    run.speed *= Math.exp(-dt * 1.5)
    if (run.fallT > FALL_TIME) {
      run.phase = 'over'
      events.push('over')
    }
  }
  while (run.trail.length && run.trail[0].d < run.d - TRAIL_LENGTH) run.trail.shift()
  return events
}
