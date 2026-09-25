import type { RefObject } from 'react'
import { useEffect } from 'react'
import { GEM_SPRITES, LAMP_SPRITES } from './art/librarySprites'

/*
 * Pointer- and frame-driven effects for the library background, tuned to stay cheap:
 *
 * - Parallax: the scene group drifts a little against the cursor, the gem group more.
 * - Lamp hover: a lamp's glow swells as the cursor nears it (--near on .landing-lamp).
 * - Magnetic gems: gems lean toward a nearby cursor; clicking one spins it with sparks.
 * - Dust: motes drift through each lamp's light, visible only inside it.
 * - Trails: each gem leaves a fading glow in its colour as it floats.
 *
 * Performance: positions come from the frame geometry (cached on resize) plus one cheap
 * position read per frame while the cursor is active; styles are written only when a value
 * actually changes;
 * parallax and gems move whole GPU layers via transform; the canvases run at 30fps and
 * reduced resolution, and the dust canvas only clears what it drew. Pointer work idles
 * once its effects have settled after the cursor stops, everything stops while the scene is
 * off-screen or the tab is hidden, and nothing runs with prefers-reduced-motion.
 */

const FRAME_W = 4075
const FRAME_H = 1545
const PARALLAX_FAR = 12
const PARALLAX_NEAR = 30
const EASE = 0.08
/** Furthest a gem leans toward the cursor, in frame units. */
const MAGNET_PULL = 26
/** Cursor distance (px) at which gems start to lean. */
const MAGNET_RANGE = 320
const DUST_PER_LAMP = 16
/** Pointer effects idle once nothing moves more than this (px / 0–1) in a frame. */
const SETTLED = 0.02
/** Resolution of the dust and trail canvases relative to CSS pixels. */
const DUST_SCALE = 1
const TRAIL_SCALE = 0.5

type Mote = { u: number; v: number; vu: number; vv: number; size: number; phase: number }
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => t * t * (3 - 2 * t)

function newMote(): Mote {
  const angle = Math.random() * Math.PI * 2
  const radius = Math.sqrt(Math.random()) * 1.3
  return {
    u: Math.cos(angle) * radius,
    v: Math.sin(angle) * radius,
    vu: (Math.random() - 0.5) * 0.008,
    vv: -0.003 - Math.random() * 0.006,
    size: 1.1 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2,
  }
}

export function useLandingScene(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const far = root.querySelector<HTMLElement>('.landing-parallax-far')!
    const near = root.querySelector<HTMLElement>('.landing-parallax-near')!
    const lampEls = LAMP_SPRITES.map((l) => root.querySelector<HTMLElement>(`[data-lamp="${l.id}"]`)!)
    const magnetEls = GEM_SPRITES.map((g) => root.querySelector<HTMLElement>(`[data-gem="${g.id}"]`)!)
    const dustCanvas = root.querySelector<HTMLCanvasElement>('.landing-dust')!
    const trailCanvas = root.querySelector<HTMLCanvasElement>('.landing-trails')!
    const dust = dustCanvas.getContext('2d')!
    const trails = trailCanvas.getContext('2d')!

    // ---- state
    const pointer = { x: 0, y: 0, inside: false }
    /** Whether pointer effects are still moving; they idle once settled. */
    let pointerActive = false
    const parallax = { x: 0, y: 0 }
    const written = { fx: 0, fy: 0, nx: 0, ny: 0 }
    const nearness = LAMP_SPRITES.map(() => 0)
    const nearWritten = LAMP_SPRITES.map(() => -1)
    const pull = GEM_SPRITES.map(() => ({ x: 0, y: 0 }))
    const pullWritten = GEM_SPRITES.map(() => ({ x: NaN, y: NaN }))
    const motes = LAMP_SPRITES.map(() => Array.from({ length: DUST_PER_LAMP }, newMote))
    let sparks: Spark[] = []
    let visible = true
    let frame = 0
    let tick = 0
    let last = performance.now()
    const start = last

    // ---- geometry: group size and frame scale, refreshed on resize only
    const geo = { w: 1, h: 1, s: 1 }
    function measure() {
      geo.w = far.clientWidth
      geo.h = far.clientHeight
      geo.s = Math.max(geo.w / FRAME_W, geo.h / FRAME_H)
      // Resizing a canvas clears it, so only do it when the size really changed.
      for (const [canvas, scale] of [
        [dustCanvas, DUST_SCALE],
        [trailCanvas, TRAIL_SCALE],
      ] as const) {
        const w = Math.round(geo.w * scale)
        const h = Math.round(geo.h * scale)
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
        }
      }
    }
    /** Frame units -> group-local CSS pixels (same cover scaling as the room). */
    function toLocal(x: number, y: number) {
      return { x: geo.w / 2 + (x - FRAME_W / 2) * geo.s, y: geo.h / 2 + (y - FRAME_H / 2) * geo.s }
    }
    /** A gem's centre in group-local px: its frame position, lean and CSS bob (estimated). */
    function gemCenter(i: number) {
      const g = GEM_SPRITES[i]
      const c = toLocal(g.box.x + g.box.w / 2, g.box.y + g.box.h / 2)
      // Mirrors landing-gem-bob: -20 -> 20 frame units, ease-in-out, alternating.
      const t = (performance.now() - start - g.phase) / (5600 * g.speed)
      const f = t - Math.floor(t)
      const p = Math.floor(t) % 2 === 0 ? f : 1 - f
      const bob = -20 + 40 * ((1 - Math.cos(Math.PI * p)) / 2)
      return { x: c.x + pull[i].x * geo.s, y: c.y + (pull[i].y + bob) * geo.s }
    }
    measure()

    // ---- events
    const wake = () => {
      if (!frame && visible) frame = requestAnimationFrame(loop)
    }
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.inside = true
      pointerActive = true
    }
    const onLeave = () => {
      pointer.inside = false
      pointerActive = true
    }
    const onGemClick = (e: MouseEvent) => {
      const magnet = e.currentTarget as HTMLElement
      magnet.classList.remove('is-spinning')
      void magnet.offsetWidth // restart the spin even if it's already playing
      magnet.classList.add('is-spinning')
      const i = magnetEls.indexOf(magnet)
      const c = gemCenter(i)
      for (let n = 0; n < 24; n++) {
        const angle = (n / 24) * Math.PI * 2 + Math.random() * 0.3
        const speed = (1.2 + Math.random() * 2.4) * TRAIL_SCALE
        sparks.push({
          x: c.x * TRAIL_SCALE,
          y: c.y * TRAIL_SCALE,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color: GEM_SPRITES[i].color,
        })
      }
    }
    const onSpinEnd = (e: AnimationEvent) => {
      if (e.animationName === 'landing-gem-spin') (e.currentTarget as Element).classList.remove('is-spinning')
    }
    const resize = new ResizeObserver(measure)
    resize.observe(far)
    const onScreen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      wake()
    })
    onScreen.observe(root)

    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    magnetEls.forEach((m) => {
      m.addEventListener('click', onGemClick)
      m.addEventListener('animationend', onSpinEnd)
    })

    function loop(now: number) {
      frame = 0
      if (!visible) return
      const dt = Math.min(now - last, 50) / 16.67 // in 60fps frames
      last = now
      tick++

      // Pointer effects only while the cursor moves or its effects are still easing.
      if (pointerActive) pointerActive = updatePointerEffects(dt) > SETTLED
      // Canvases at 30fps.
      if (tick % 2 === 0) {
        drawDust(dt * 2)
        drawTrails(dt * 2)
      }
      frame = requestAnimationFrame(loop)
    }

    /** Eases parallax, lamp glow and gem lean toward the cursor; returns the largest step. */
    function updatePointerEffects(dt: number) {
      let moved = 0
      const tx = pointer.inside ? (pointer.x / window.innerWidth) * 2 - 1 : 0
      const ty = pointer.inside ? (pointer.y / window.innerHeight) * 2 - 1 : 0
      const ox = parallax.x
      const oy = parallax.y
      parallax.x = lerp(parallax.x, tx, EASE * dt)
      parallax.y = lerp(parallax.y, ty, EASE * dt)
      moved = Math.max(moved, Math.abs(parallax.x - ox) * PARALLAX_NEAR, Math.abs(parallax.y - oy) * PARALLAX_NEAR)

      // Pointer in far-group coordinates (one read per active frame; it also follows the
      // load-in pan and scrolling), then in the near group, which sits further along.
      const r = far.getBoundingClientRect()
      const k = geo.w / (r.width || 1)
      const px = (pointer.x - r.left) * k
      const py = (pointer.y - r.top) * k
      const nx = px + written.fx - written.nx
      const ny = py + written.fy - written.ny

      LAMP_SPRITES.forEach((lamp, i) => {
        const c = toLocal(lamp.shade.x, lamp.shade.y)
        const d = Math.hypot(px - c.x, py - c.y)
        const target = pointer.inside ? smooth(Math.max(0, 1 - d / (lamp.shade.w * geo.s * 3.2))) : 0
        const next = lerp(nearness[i], target, EASE * 1.5 * dt)
        moved = Math.max(moved, Math.abs(next - nearness[i]))
        nearness[i] = next
      })
      GEM_SPRITES.forEach((g, i) => {
        const c = toLocal(g.box.x + g.box.w / 2, g.box.y + g.box.h / 2)
        const dx = nx - c.x
        const dy = ny - c.y
        const d = Math.hypot(dx, dy) || 1
        const strength = pointer.inside ? smooth(Math.max(0, 1 - d / MAGNET_RANGE)) : 0
        const x = lerp(pull[i].x, (dx / d) * strength * MAGNET_PULL, EASE * dt)
        const y = lerp(pull[i].y, (dy / d) * strength * MAGNET_PULL, EASE * dt)
        moved = Math.max(moved, Math.abs(x - pull[i].x) * geo.s, Math.abs(y - pull[i].y) * geo.s)
        pull[i].x = x
        pull[i].y = y
      })

      // Write only what changed.
      const fx = Math.round(parallax.x * -PARALLAX_FAR * 10) / 10
      const fy = Math.round(parallax.y * -PARALLAX_FAR * 7) / 10
      if (fx !== written.fx || fy !== written.fy) {
        written.fx = fx
        written.fy = fy
        written.nx = Math.round(parallax.x * -PARALLAX_NEAR * 10) / 10
        written.ny = Math.round(parallax.y * -PARALLAX_NEAR * 7) / 10
        far.style.transform = `translate3d(${fx}px, ${fy}px, 0)`
        near.style.transform = `translate3d(${written.nx}px, ${written.ny}px, 0)`
      }
      nearness.forEach((v, i) => {
        const rounded = Math.round(v * 100) / 100
        if (rounded !== nearWritten[i]) {
          nearWritten[i] = rounded
          lampEls[i].style.setProperty('--near', String(rounded))
        }
      })
      pull.forEach((p, i) => {
        const x = Math.round(p.x * geo.s * 10) / 10
        const y = Math.round(p.y * geo.s * 10) / 10
        if (x !== pullWritten[i].x || y !== pullWritten[i].y) {
          pullWritten[i] = { x, y }
          magnetEls[i].style.transform = `translate3d(${x}px, ${y}px, 0)`
        }
      })
      return moved
    }

    function drawDust(dt: number) {
      const k = DUST_SCALE
      LAMP_SPRITES.forEach((lamp, i) => {
        const c = toLocal(lamp.shade.x, lamp.shade.y)
        const radius = lamp.shade.w * geo.s * 1.45
        // Clear only this lamp's patch of the canvas.
        const pad = radius * 1.5
        dust.clearRect((c.x - pad) * k, (c.y - pad) * k, pad * 2 * k, pad * 2 * k)
        for (const m of motes[i]) {
          m.vu = (m.vu + (Math.random() - 0.5) * 0.0012 * dt) * 0.985
          m.u += m.vu * dt
          m.v += m.vv * dt
          m.phase += 0.03 * dt
          if (Math.hypot(m.u, m.v) > 1.35) Object.assign(m, newMote(), { v: 1 + Math.random() * 0.2 })
          const falloff = Math.max(0, 1 - Math.hypot(m.u, m.v) / 1.35)
          const alpha = Math.min(1, falloff * (0.55 + 0.4 * Math.sin(m.phase)) * (0.9 + nearness[i] * 0.6))
          if (alpha <= 0.02) continue
          dust.fillStyle = `rgba(255, 238, 196, ${alpha.toFixed(2)})`
          dust.beginPath()
          dust.arc((c.x + m.u * radius) * k, (c.y + m.v * radius * 0.9) * k, m.size * k, 0, Math.PI * 2)
          dust.fill()
        }
      })
    }

    function drawTrails(dt: number) {
      const k = TRAIL_SCALE
      trails.globalCompositeOperation = 'destination-out'
      trails.fillStyle = `rgba(0, 0, 0, ${Math.min(0.14 * dt, 1).toFixed(3)})`
      trails.fillRect(0, 0, trailCanvas.width, trailCanvas.height)
      trails.globalCompositeOperation = 'lighter'
      GEM_SPRITES.forEach((g, i) => {
        const c = gemCenter(i)
        // The gem itself is roughly the middle fifth of its sprite box; the rest is glow.
        const radius = g.box.w * 0.09 * geo.s * k
        const glow = trails.createRadialGradient(c.x * k, c.y * k, 0, c.x * k, c.y * k, radius)
        glow.addColorStop(0, `rgba(${g.color}, 0.16)`)
        glow.addColorStop(1, `rgba(${g.color}, 0)`)
        trails.fillStyle = glow
        trails.fillRect(c.x * k - radius, c.y * k - radius, radius * 2, radius * 2)
      })
      sparks = sparks.filter((s) => s.life > 0)
      for (const s of sparks) {
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vx *= 0.94
        s.vy = s.vy * 0.94 + 0.03 * k * dt
        s.life -= 0.022 * dt
        trails.fillStyle = `rgba(${s.color}, ${Math.max(s.life, 0).toFixed(2)})`
        trails.beginPath()
        trails.arc(s.x, s.y, 2.2 * k * s.life + 0.4, 0, Math.PI * 2)
        trails.fill()
      }
    }

    wake()

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      onScreen.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      magnetEls.forEach((m) => {
        m.removeEventListener('click', onGemClick)
        m.removeEventListener('animationend', onSpinEnd)
      })
    }
  }, [rootRef])
}
