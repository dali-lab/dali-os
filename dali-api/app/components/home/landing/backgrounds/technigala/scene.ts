import type { RunAudio } from './audio'
import {
  createRun,
  LANE_ANGLE,
  LANES,
  lane,
  queueJump,
  ROW,
  rowAt,
  runBoost,
  runScore,
  stepRun,
  type Piece,
  type Run,
} from './course'
import { catmull, clamp, lerp, mix, seededRandom, smooth, sparkle, TAU, type Point } from './paint'
import { drawRunner } from './runner'

/*
 * The week 10 scene, from the Technigala 26F poster: a film-strip tunnel running into a white core,
 * yellow beams fanning out of it, and a trail leading in. Holding anywhere on it speeds the tunnel
 * up; letting go drops you into a run down it.
 */

export type ScenePhase = 'attract' | 'play' | 'paused' | 'over'

export type RunReport = {
  score: number
  durationMs: number
  endedBy: 'fall' | 'quit'
  /** The piece of course the runner fell through. */
  obstacle: Piece | null
}

type Options = {
  audio: RunAudio
  reducedMotion: boolean
  onPhase: (phase: ScenePhase) => void
  onScore: (score: number) => void
  /** Every run that ends, by a fall or by leaving it. */
  onRunEnd: (report: RunReport) => void
  onMute: (muted: boolean) => void
}

const DMIN = 0.3
const DMAX = 7.5
const RINGS = 26
const ZP = 1.25
const ZFAR = 15
const ZNEAR = 0.32
const VOLT = '#f2f53d'
const MINT = '#c9f7e2'

const BEAMS = [-2.8, -2.52, -2.24, -1.97, -1.7, -1.44, -1.16, -0.86, -0.55].map((a, i) => ({
  a,
  l: 0.66 + ((i * 37) % 5) * 0.085,
  w: 0.026 + ((i * 13) % 3) * 0.008,
  ph: i * 1.7,
}))

type Mote = { a: number; rr: number; d: number; c: string; s: number }

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function createTunnelScene(canvas: HTMLCanvasElement, options: Options) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { audio, reducedMotion } = options
  const random = seededRandom(7)

  let W = 1
  let H = 1
  let vp: Point = { x: 0, y: 0 }
  let speed = 1
  let travel = 0
  let flash = 0
  let intro = 0
  let hold = false
  let motes: Mote[] = []
  const bursts: { r: number }[] = []
  const pointer = { x: 0, y: 0, inside: false }
  let drag: { x: number; moved: boolean } | null = null

  let phase: ScenePhase = 'attract'
  let run: Run | null = null
  let lastScore = -1

  const narrow = () => W < 900 || W / H < 1.1
  const base = (): Point => (narrow() ? { x: W * 0.5, y: H * 0.62 } : { x: W * 0.3, y: H * 0.47 })
  const K = () => H * 0.36
  const center = (d: number): Point => {
    const b = base()
    const f = Math.min(1, 0.85 / d)
    return { x: vp.x + (b.x - vp.x) * f, y: vp.y + (b.y - vp.y) * f }
  }
  const newMote = (anywhere: boolean): Mote => ({
    a: random() * TAU,
    rr: 0.3 + random() * 1.25,
    d: anywhere ? DMIN + random() * (DMAX - DMIN) : DMAX,
    c: random() < 0.14 ? VOLT : random() < 0.5 ? MINT : '#ffffff',
    s: 0.6 + random() * 0.8,
  })
  const project = (m: Mote, d: number): Point => {
    const c = center(d)
    const rr = (m.rr * K()) / d
    return { x: c.x + Math.cos(m.a) * rr, y: c.y + Math.sin(m.a) * rr * 0.9 }
  }

  function setPhase(next: ScenePhase) {
    phase = next
    canvas.dataset.phase = next
    options.onPhase(next)
  }

  function start() {
    if (reducedMotion) return
    run = createRun()
    flash = 1
    bursts.push({ r: 0 })
    lastScore = -1
    audio.start()
    setPhase('play')
  }

  function report(r: Run): RunReport {
    const fell = r.phase !== 'play'
    return {
      score: runScore(r),
      durationMs: Math.round(r.t * 1000),
      endedBy: fell ? 'fall' : 'quit',
      obstacle: fell ? r.endedOn : null,
    }
  }

  function exit() {
    if (run && phase !== 'over') options.onRunEnd(report(run))
    audio.stop()
    run = null
    drag = null
    setPhase('attract')
  }

  function setPaused(paused: boolean) {
    if (!run || run.phase === 'over') return
    if (paused === (phase === 'paused')) return
    run.left = run.right = false
    run.steer = 0
    drag = null
    audio.pause(paused)
    setPhase(paused ? 'paused' : 'play')
  }

  /* ---------- Drawing ---------- */

  function drawBeams(t: number, boost: number) {
    BEAMS.forEach((bm, bi) => {
      const grow = smooth(0.25 + bi * 0.06, 0.85 + bi * 0.06, intro)
      if (grow <= 0) return
      const ang = bm.a + Math.sin(t * 0.21 + bm.ph) * 0.025
      const len = H * bm.l * (0.92 + 0.08 * Math.sin(t * 0.7 + bm.ph)) * (1 + 0.45 * boost + 0.3 * flash) * grow
      const dx = Math.cos(ang)
      const dy = Math.sin(ang)
      const nx = -dy
      const ny = dx
      const w1 = H * bm.w * (1 + 0.3 * boost)
      const st = H * 0.03
      const sx = vp.x + dx * st
      const sy = vp.y + dy * st
      const ex = vp.x + dx * len
      const ey = vp.y + dy * len
      let gr = ctx!.createLinearGradient(vp.x, vp.y, ex, ey)
      gr.addColorStop(0, 'rgba(255,255,235,0.95)')
      gr.addColorStop(0.14, 'rgba(242,245,61,0.85)')
      gr.addColorStop(0.66, 'rgba(242,245,61,0.3)')
      gr.addColorStop(1, 'rgba(242,245,61,0)')
      ctx!.fillStyle = gr
      ctx!.beginPath()
      ctx!.moveTo(sx + nx * w1 * 0.06, sy + ny * w1 * 0.06)
      ctx!.lineTo(ex + nx * w1, ey + ny * w1)
      ctx!.lineTo(ex - nx * w1 * 0.15, ey - ny * w1 * 0.15)
      ctx!.lineTo(sx, sy)
      ctx!.closePath()
      ctx!.fill()
      gr = ctx!.createLinearGradient(vp.x, vp.y, ex, ey)
      gr.addColorStop(0, 'rgba(225,255,242,0.65)')
      gr.addColorStop(0.5, 'rgba(190,240,220,0.16)')
      gr.addColorStop(1, 'rgba(190,240,220,0)')
      ctx!.fillStyle = gr
      ctx!.beginPath()
      ctx!.moveTo(sx, sy)
      ctx!.lineTo(ex + nx * w1 * 1.5, ey + ny * w1 * 1.5)
      ctx!.lineTo(ex + nx * w1 * 1.04, ey + ny * w1 * 1.04)
      ctx!.closePath()
      ctx!.fill()
      ctx!.strokeStyle = 'rgba(245,150,80,0.32)'
      ctx!.lineWidth = 1
      ctx!.beginPath()
      ctx!.moveTo(sx, sy)
      ctx!.lineTo(ex - nx * w1 * 0.15, ey - ny * w1 * 0.15)
      ctx!.stroke()
    })
  }

  function drawMotes(dt: number, alpha: number, boost: number) {
    const g = ctx!
    g.lineCap = 'round'
    const streak = 0.03 + 0.3 * boost
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i]
      m.d -= dt * 0.32 * speed * m.s
      if (m.d < DMIN) {
        motes[i] = newMote(false)
        continue
      }
      const p = project(m, m.d)
      const q = project(m, m.d + streak * m.d)
      g.strokeStyle = m.c
      g.globalAlpha = smooth(DMAX, DMAX - 2.2, m.d) * 0.85 * alpha
      g.lineWidth = clamp(1.8 / m.d, 0.5, 3.2)
      g.beginPath()
      g.moveTo(q.x, q.y)
      g.lineTo(p.x, p.y + 0.01)
      g.stroke()
    }
    g.globalAlpha = 1
  }

  function drawBursts(dt: number) {
    const g = ctx!
    for (let i = bursts.length - 1; i >= 0; i--) {
      const bu = bursts[i]
      bu.r += dt * H * 1.5
      const p = bu.r / (H * 1.3)
      if (p >= 1) {
        bursts.splice(i, 1)
        continue
      }
      g.strokeStyle = `rgba(230,255,240,${(1 - p) * 0.8})`
      g.lineWidth = 3 * (1 - p) + 0.5
      g.beginPath()
      g.ellipse(vp.x, vp.y, bu.r, bu.r * 0.9, -0.2, 0, TAU)
      g.stroke()
    }
  }

  function vignette() {
    const g = ctx!
    const gr = g.createRadialGradient(W * 0.42, H * 0.5, Math.max(W, H) * 0.3, W * 0.42, H * 0.5, Math.max(W, H) * 0.85)
    gr.addColorStop(0, 'rgba(1,6,5,0)')
    gr.addColorStop(1, 'rgba(1,6,5,0.7)')
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)
  }

  function trailPoints() {
    const b = base()
    const pts = (
      narrow()
        ? [[-0.05, 1.02], [0.12, 0.96], [0.3, 0.99], [0.42, 0.92], [0.4, 0.84], [0.47, 0.76]]
        : [[-0.03, 0.95], [0.08, 0.87], [0.17, 0.91], [0.25, 0.84], [0.25, 0.75], [0.285, 0.63]]
    ).map(([x, y]) => ({ x: x * W, y: y * H }))
    pts.push({ x: vp.x + (b.x - vp.x) * 0.2, y: vp.y + H * 0.07 })
    return catmull(pts, 14)
  }

  function attractFrame(t: number, dt: number) {
    const g = ctx!
    const b = base()
    intro = Math.min(1, intro + dt / 2.2)
    const ie = 1 - Math.pow(1 - intro, 3)
    const target = pointer.inside
      ? { x: b.x + (pointer.x - b.x) * 0.2, y: b.y + (pointer.y - b.y) * 0.2 }
      : { x: b.x + Math.sin(t * 0.13) * W * 0.014, y: b.y + Math.cos(t * 0.11) * H * 0.014 }
    vp.x += (target.x - vp.x) * Math.min(1, dt * 2.5)
    vp.y += (target.y - vp.y) * Math.min(1, dt * 2.5)
    const targetSpeed = hold ? 5.5 : 1 + (1 - ie) * 6
    speed += (targetSpeed - speed) * Math.min(1, dt * (hold ? 1.6 : 2.2))
    const boost = clamp((speed - 1) / 4.5, 0, 1.4)
    travel += dt * 0.32 * speed
    flash = Math.max(0, flash - dt * 1.3)

    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    let gr = g.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, Math.max(W, H) * 0.95)
    gr.addColorStop(0, '#c8f6e0')
    gr.addColorStop(0.07, '#62d1a6')
    gr.addColorStop(0.2, '#1d7a5f')
    gr.addColorStop(0.42, '#0b3a31')
    gr.addColorStop(0.72, '#051d19')
    gr.addColorStop(1, '#020b0a')
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)
    // the cool blue in the dark on the poster's left
    gr = g.createRadialGradient(W * 0.05, H * 0.3, 0, W * 0.05, H * 0.3, H * 0.9)
    gr.addColorStop(0, 'rgba(25,60,90,0.35)')
    gr.addColorStop(1, 'rgba(25,60,90,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)

    const span = DMAX - DMIN
    const rings = Array.from({ length: RINGS }, (_, i) => {
      let d = ((i / RINGS) * span - travel) % span
      if (d < 0) d += span
      return { i, d: d + DMIN }
    }).sort((p, q) => q.d - p.d)
    g.lineCap = 'butt'
    for (const { i, d } of rings) {
      const c = center(d)
      const rad = K() / d
      const bw = rad * 0.2
      if (rad > Math.max(W, H) * 1.8) continue
      const a = smooth(DMAX, DMAX - 1.6, d) * smooth(DMIN, DMIN + 0.3, d) * ie
      if (a < 0.01) continue
      const tone = Math.pow(clamp((d - 0.5) / 5, 0, 1), 0.75)
      const a0 = i * 2.39 + t * 0.05 + d * 0.28
      const sweep = TAU * 0.8
      g.save()
      g.translate(c.x, c.y)
      g.rotate(-0.2)
      g.scale(1, 0.9)
      g.globalAlpha = a
      g.strokeStyle = mix('#10302a', '#d9efe5', tone)
      g.lineWidth = bw
      g.beginPath()
      g.arc(0, 0, rad, a0, a0 + sweep)
      g.stroke()
      g.strokeStyle = mix('#04130f', '#9cbcae', tone)
      g.lineWidth = Math.max(0.6, bw * 0.05)
      g.beginPath()
      g.arc(0, 0, rad + bw * 0.5, a0, a0 + sweep)
      g.stroke()
      g.beginPath()
      g.arc(0, 0, rad - bw * 0.5, a0, a0 + sweep)
      g.stroke()
      if (bw > 3) {
        const hw = bw * 0.12
        const pitch = bw * 0.27
        const dash = Math.max(0.01, hw * 1.3 - hw)
        g.strokeStyle = tone < 0.45 ? 'rgba(95,225,175,0.55)' : 'rgba(40,74,64,0.55)'
        g.lineWidth = hw
        g.lineCap = 'round'
        g.setLineDash([dash, pitch - dash])
        for (const s of [-0.36, 0.36]) {
          g.beginPath()
          g.arc(0, 0, rad + bw * s, a0, a0 + sweep)
          g.stroke()
        }
        g.setLineDash([])
        g.lineCap = 'butt'
        if (bw > 10) {
          g.strokeStyle = 'rgba(0,0,0,0.22)'
          g.lineWidth = bw * 0.52
          g.setLineDash([Math.max(1, bw * 0.035), bw * 1.1])
          g.beginPath()
          g.arc(0, 0, rad, a0, a0 + sweep)
          g.stroke()
          g.setLineDash([])
        }
      }
      g.restore()
    }
    g.globalAlpha = 1

    g.globalCompositeOperation = 'lighter'
    const cr = H * (0.26 + 0.07 * boost + 0.22 * flash)
    gr = g.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, cr)
    gr.addColorStop(0, 'rgba(255,255,246,1)')
    gr.addColorStop(0.16, 'rgba(230,255,240,0.82)')
    gr.addColorStop(0.45, 'rgba(120,230,185,0.26)')
    gr.addColorStop(1, 'rgba(40,160,120,0)')
    g.fillStyle = gr
    g.fillRect(vp.x - cr, vp.y - cr, cr * 2, cr * 2)
    drawBeams(t, boost)
    drawMotes(dt, ie, boost)
    drawBursts(dt)
    sparkle(g, vp.x, vp.y, H * (0.05 + 0.01 * Math.sin(t * 2.1) + 0.05 * flash + 0.015 * boost) * ie, t * 0.08 + 0.2)

    const tp = trailPoints()
    const reveal = smooth(0.1, 0.9, intro)
    const segments = Math.floor((tp.length - 1) * reveal)
    const pulse = (t * 0.22) % 1.4
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < segments; i++) {
        const u = i / (tp.length - 1)
        const w = lerp(4.2, 0.8, u) * (W / 1200 + 0.3)
        const hi = Math.exp(-Math.pow((u - pulse) / 0.06, 2))
        g.beginPath()
        g.moveTo(tp[i].x, tp[i].y)
        g.lineTo(tp[i + 1].x, tp[i + 1].y)
        if (pass === 0) {
          g.strokeStyle = `rgba(242,245,61,${0.1 + 0.1 * hi})`
          g.lineWidth = w * 6
        } else if (pass === 1) {
          g.strokeStyle = `rgba(242,245,61,${0.55 + 0.3 * hi})`
          g.lineWidth = w * 1.7
        } else {
          g.strokeStyle = `rgba(255,255,215,${0.75 + 0.25 * hi})`
          g.lineWidth = w * 0.6
        }
        g.stroke()
      }
    }
    for (let i = 0; i < 26; i++) {
      const p = tp[Math.floor(((i * 0.618) % 1) * 12)]
      const twinkle = 0.5 + 0.5 * Math.sin(t * 3 + i * 2.1)
      g.fillStyle = `rgba(242,245,61,${0.25 * twinkle * reveal})`
      g.fillRect(p.x + Math.sin(i * 7.3) * 10, p.y + Math.cos(i * 3.1) * 8, 1.5, 1.5)
    }

    g.globalCompositeOperation = 'source-over'
    vignette()
  }

  function gameFrame(t: number, dt: number, r: Run) {
    const g = ctx!
    if (phase === 'paused') dt = 0
    else {
      for (const event of stepRun(r, dt)) {
        if (event === 'jump') audio.jump()
        else if (event === 'land') audio.land()
        else if (event === 'fall') audio.fall()
        else if (event === 'over') {
          audio.stop()
          setPhase('over')
          options.onRunEnd(report(r))
        }
      }
    }
    const boost = runBoost(r)
    if (phase === 'play') audio.frame(boost)
    const b = base()
    vp.x += (b.x - vp.x) * Math.min(1, dt * 3)
    vp.y += (b.y - vp.y) * Math.min(1, dt * 3)
    const F = K()
    const vx = vp.x
    const vy = vp.y
    speed = 1 + r.speed / 3
    flash = Math.max(0, flash - dt * 1.4)
    const P = (a: number, z: number, rr: number): [number, number] => {
      const sa = a - r.th + Math.PI / 2
      const R = (F * rr) / z
      return [vx + Math.cos(sa) * R, vy + Math.sin(sa) * R]
    }
    const quad = (a0: number, a1: number, z0: number, z1: number) => {
      let p = P(a0, z0, 1)
      g.moveTo(p[0], p[1])
      p = P(a1, z0, 1)
      g.lineTo(p[0], p[1])
      p = P(a1, z1, 1)
      g.lineTo(p[0], p[1])
      p = P(a0, z1, 1)
      g.lineTo(p[0], p[1])
      g.closePath()
    }

    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    let gr = g.createRadialGradient(vx, vy, 0, vx, vy, Math.max(W, H) * 0.95)
    gr.addColorStop(0, '#2f8a6b')
    gr.addColorStop(0.04, '#174f40')
    gr.addColorStop(0.18, '#082620')
    gr.addColorStop(0.5, '#041714')
    gr.addColorStop(1, '#020b0a')
    g.fillStyle = gr
    g.fillRect(0, 0, W, H)

    // The course: twelve film strips running into the light, frame by frame.
    const LW = LANE_ANGLE
    const cam = r.d - ZP
    const i0 = Math.floor((cam + ZNEAR) / ROW) - 1
    const i1 = Math.floor((cam + ZFAR) / ROW)
    const gapA = LW * 0.03
    for (let i = i1; i >= i0; i--) {
      const z0 = Math.max(ZNEAR, i * ROW - cam + ROW * 0.035)
      const z1 = (i + 1) * ROW - cam - ROW * 0.035
      if (z1 <= ZNEAR + 0.01) continue
      const row = rowAt(r, i)
      const zm = (z0 + z1) / 2
      const tone = 0.3 + 0.38 * Math.pow(clamp((zm - 1) / 13, 0, 1), 0.8)
      const alpha = smooth(ZFAR, ZFAR - 2.5, zm)
      if (alpha <= 0.01) continue
      g.globalAlpha = alpha
      g.beginPath()
      for (let l = 0; l < LANES; l++) if (!row || row[l]) quad(l * LW - LW / 2 + gapA, l * LW + LW / 2 - gapA, z0, z1)
      g.fillStyle = mix('#1a4a3f', '#8fe6c2', tone)
      g.fill()
      if (row) {
        // A bright lip wherever the floor drops away, so holes read as holes.
        const ahead = rowAt(r, i + 1)
        const behind = i > 0 ? rowAt(r, i - 1) : null
        g.beginPath()
        for (let l = 0; l < LANES; l++) {
          if (!row[l]) continue
          const a0 = l * LW - LW / 2 + gapA
          const a1 = l * LW + LW / 2 - gapA
          const edge = (aa: number, za: number, ab: number, zb: number) => {
            let p = P(aa, za, 1)
            g.moveTo(p[0], p[1])
            p = P(ab, zb, 1)
            g.lineTo(p[0], p[1])
          }
          if (ahead && !ahead[l]) edge(a0, z1, a1, z1)
          if (behind && !behind[l]) edge(a0, z0, a1, z0)
          if (!row[lane(l - 1)]) edge(a0, z0, a0, z1)
          if (!row[lane(l + 1)]) edge(a1, z0, a1, z1)
        }
        g.strokeStyle = 'rgba(225,255,240,0.9)'
        g.lineWidth = clamp((F * 0.018) / zm, 1, 4)
        g.lineCap = 'round'
        g.stroke()
      }
      if (tone < 0.85) {
        g.beginPath()
        for (let l = 0; l < LANES; l++) if (!row || row[l]) quad(l * LW - LW * 0.3, l * LW + LW * 0.3, lerp(z0, z1, 0.12), lerp(z0, z1, 0.88))
        g.fillStyle = `rgba(110,225,180,${0.1 * (1 - tone)})`
        g.fill()
      }
      if ((F / z1) * LW * 0.05 > 1.1) {
        g.beginPath()
        for (let l = 0; l < LANES; l++) {
          if (row && !row[l]) continue
          for (const ea of [-0.41, 0.41]) {
            for (const ez of [0.25, 0.75]) {
              const ac = l * LW + ea * LW
              const zc = lerp(z0, z1, ez)
              quad(ac - LW * 0.028, ac + LW * 0.028, zc - ROW * 0.08, zc + ROW * 0.08)
            }
          }
        }
        g.fillStyle = `rgba(100,230,180,${0.28 * (1 - tone)})`
        g.fill()
      }
    }
    g.globalAlpha = 1

    g.globalCompositeOperation = 'lighter'
    const cr = H * (0.07 + 0.02 * boost)
    gr = g.createRadialGradient(vx, vy, 0, vx, vy, cr)
    gr.addColorStop(0, 'rgba(255,255,246,0.75)')
    gr.addColorStop(0.3, 'rgba(230,255,240,0.3)')
    gr.addColorStop(1, 'rgba(120,230,185,0)')
    g.fillStyle = gr
    g.fillRect(vx - cr, vy - cr, cr * 2, cr * 2)
    g.globalAlpha = 0.28
    drawBeams(t, boost * 0.6)
    g.globalAlpha = 1
    drawMotes(dt, 0.28, 0)
    drawBursts(dt)

    const sc = W / 1200 + 0.35
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const [color, width] of [
      ['rgba(242,245,61,0.16)', 12],
      ['rgba(242,245,61,0.6)', 4],
      ['rgba(255,255,215,0.95)', 1.6],
    ] as const) {
      g.beginPath()
      let started = false
      for (const p of r.trail) {
        const z = p.d - cam
        if (z < ZNEAR + 0.05) continue
        const q = P(p.th, z, 1 - p.y)
        if (started) g.lineTo(q[0], q[1])
        else {
          g.moveTo(q[0], q[1])
          started = true
        }
      }
      g.strokeStyle = color
      g.lineWidth = width * sc
      g.stroke()
    }
    g.globalCompositeOperation = 'source-over'

    const fade = r.phase === 'play' ? 1 : 1 - smooth(0.2, 0.9, r.fallT)
    const [fx, fy] = P(r.th, ZP, 1 - r.y + r.fallZ)
    drawRunner(g, fx, fy, (F * 0.4) / ZP, r.d * 5.2, r.y > 0.02, -r.thv * 0.05, fade)

    sparkle(g, vx, vy, H * (0.018 + 0.004 * Math.sin(t * 2.1)), t * 0.08 + 0.2, 0.6)
    if (flash > 0) {
      g.fillStyle = `rgba(240,255,248,${flash * 0.85})`
      g.fillRect(0, 0, W, H)
    }
    vignette()

    const score = runScore(r)
    if (score !== lastScore) {
      lastScore = score
      options.onScore(score)
    }
  }

  function frame(t: number, dt: number) {
    if (run) gameFrame(t, dt, run)
    else attractFrame(t, dt)
  }

  /* ---------- Sizing and the loop ---------- */

  let raf = 0
  let last = 0
  let onScreen = true
  const t0 = performance.now()

  function renderStill() {
    let t = 0
    for (let i = 0; i < 150; i++) {
      t += 1 / 30
      attractFrame(t, 1 / 30)
    }
  }

  function resize() {
    const box = canvas.getBoundingClientRect()
    W = Math.max(1, box.width)
    H = Math.max(1, box.height)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(W * dpr)
    canvas.height = Math.round(H * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    vp = base()
    if (reducedMotion) renderStill()
  }

  function loop(ts: number) {
    raf = 0
    if (document.hidden || !onScreen) return
    const dt = Math.min(0.05, (ts - last) / 1000)
    last = ts
    frame((ts - t0) / 1000, dt)
    raf = requestAnimationFrame(loop)
  }

  function kick() {
    if (raf || reducedMotion || document.hidden || !onScreen) return
    last = performance.now()
    raf = requestAnimationFrame(loop)
  }

  /* ---------- Input ---------- */

  const local = (e: PointerEvent) => {
    const box = canvas.getBoundingClientRect()
    pointer.x = e.clientX - box.left
    pointer.y = e.clientY - box.top
    pointer.inside = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= box.width && pointer.y <= box.height
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button > 0) return
    local(e)
    if (phase === 'attract') {
      if (reducedMotion) return
      hold = true
    } else if (phase === 'play') {
      drag = { x: pointer.x, moved: false }
    } else return
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // Capture is a nicety: without it a drag that leaves the canvas just ends early.
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    local(e)
    if (drag && run) {
      const dx = pointer.x - drag.x
      if (Math.abs(dx) > 8) drag.moved = true
      run.steer = clamp(-dx / (W * 0.05), -1, 1)
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    local(e)
    if (phase === 'attract') {
      const go = hold
      hold = false
      if (go) start()
      return
    }
    if (drag && run) {
      if (!drag.moved && phase === 'play') queueJump(run)
      drag = null
      run.steer = 0
    }
  }

  const onPointerCancel = () => {
    hold = false
    if (drag && run) run.steer = 0
    drag = null
  }

  const onPointerLeave = () => {
    pointer.inside = false
  }

  const onKey = (e: KeyboardEvent) => {
    if (phase === 'attract' || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    const down = e.type === 'keydown'
    const k = e.key
    const left = k === 'ArrowLeft' || k === 'a' || k === 'A'
    const right = k === 'ArrowRight' || k === 'd' || k === 'D'
    const jump = k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W'
    if (k === 'Escape') {
      if (down) exit()
      e.preventDefault()
      return
    }
    if (k === 'p' || k === 'P') {
      if (down && !e.repeat) setPaused(phase !== 'paused')
      e.preventDefault()
      return
    }
    if (k === 'm' || k === 'M') {
      if (down && !e.repeat) options.onMute(audio.toggleMute())
      e.preventDefault()
      return
    }
    if (phase === 'over') {
      if (down && (jump || k === 'Enter')) {
        e.preventDefault()
        if (!e.repeat) start()
      }
      return
    }
    if (!run || phase !== 'play') return
    if (left) {
      run.left = down
      e.preventDefault()
    } else if (right) {
      run.right = down
      e.preventDefault()
    } else if (jump) {
      if (down && !e.repeat) queueJump(run)
      e.preventDefault()
    }
  }

  const onVisibility = () => {
    if (document.hidden) setPaused(true)
    kick()
  }

  const observer = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting
    if (!onScreen) setPaused(true)
    kick()
  })
  const sizer = new ResizeObserver(resize)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('pointerleave', onPointerLeave)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  observer.observe(canvas)
  sizer.observe(canvas)

  motes = Array.from({ length: 280 }, () => newMote(true))
  resize()
  canvas.dataset.phase = phase
  kick()

  return {
    start,
    exit,
    togglePause: () => setPaused(phase !== 'paused'),
    toggleMute: () => options.onMute(audio.toggleMute()),
    destroy() {
      if (run && phase !== 'over') options.onRunEnd(report(run))
      cancelAnimationFrame(raf)
      raf = 0
      audio.close()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
      sizer.disconnect()
    },
  }
}

export type TunnelScene = NonNullable<ReturnType<typeof createTunnelScene>>
