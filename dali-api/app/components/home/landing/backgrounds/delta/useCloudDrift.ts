import type { RefObject } from 'react'
import { useEffect } from 'react'

/*
 * The cursor's pull on the clouds.
 *
 * Each cloud leans toward the cursor as it passes near, and eases back out as it moves away. The
 * pull is small and slow on purpose: it should read as the air moving, not as the cloud following
 * the mouse.
 *
 * Kept cheap the same way the library scene is: the loop only runs while something is still
 * easing, positions are written as transforms on their own layers so nothing repaints, a style is
 * only written when the rounded value actually changes, it stops while the scene is off-screen or
 * the tab is hidden, and it never runs at all under prefers-reduced-motion.
 *
 * A cloud's position has to be measured each frame rather than cached, because its crossing is a
 * CSS animation -- the element is somewhere new every frame whether the cursor moves or not.
 */

/** Furthest a cloud leans toward the cursor, in pixels. */
const PULL = 34
/** Cursor distance at which a cloud starts to feel it. */
const RANGE = 520
/** How quickly the lean catches up. Low, so the clouds drift into it rather than snapping. */
const EASE = 0.035
/** The loop idles once nothing moves more than this in a frame, in pixels. */
const SETTLED = 0.05

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => t * t * (3 - 2 * t)

export function useCloudDrift(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const clouds = [...root.querySelectorAll<HTMLElement>('.delta-cloud')]
    const pulls = clouds.map(() => ({ x: 0, y: 0 }))
    const written = clouds.map(() => ({ x: NaN, y: NaN }))
    const layers = clouds.map((cloud) => cloud.querySelector<HTMLElement>('.delta-cloud-pull')!)

    const pointer = { x: 0, y: 0, inside: false }
    let active = false
    let visible = true
    let frame = 0
    let last = performance.now()

    const wake = () => {
      if (!frame && visible) frame = requestAnimationFrame(loop)
    }
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.inside = true
      active = true
      wake()
    }
    const onLeave = () => {
      pointer.inside = false
      active = true
      wake()
    }

    const onScreen = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      wake()
    })
    onScreen.observe(root)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)

    function loop(now: number) {
      frame = 0
      if (!visible) return
      const dt = Math.min(now - last, 50) / 16.67 // in 60fps frames
      last = now
      // While the cursor is over the scene the clouds keep passing through its reach, so the loop
      // has to keep measuring. Once it leaves, it only runs until the leans have eased back out.
      active = update(dt) > SETTLED || pointer.inside
      if (active) frame = requestAnimationFrame(loop)
    }

    /** Eases every cloud toward the cursor; returns the largest step, in pixels. */
    function update(dt: number) {
      let moved = 0
      for (let i = 0; i < clouds.length; i++) {
        let targetX = 0
        let targetY = 0
        if (pointer.inside) {
          const box = clouds[i].getBoundingClientRect()
          // The drawn cloud sits in the middle of its box; the rest of the box is empty.
          const dx = pointer.x - (box.left + box.width / 2)
          const dy = pointer.y - (box.top + box.height / 2)
          const distance = Math.hypot(dx, dy) || 1
          const strength = smooth(Math.max(0, 1 - distance / RANGE))
          targetX = (dx / distance) * strength * PULL
          targetY = (dy / distance) * strength * PULL
        }
        const x = lerp(pulls[i].x, targetX, EASE * dt)
        const y = lerp(pulls[i].y, targetY, EASE * dt)
        moved = Math.max(moved, Math.abs(x - pulls[i].x), Math.abs(y - pulls[i].y))
        pulls[i].x = x
        pulls[i].y = y

        const rx = Math.round(x * 10) / 10
        const ry = Math.round(y * 10) / 10
        if (rx !== written[i].x || ry !== written[i].y) {
          written[i] = { x: rx, y: ry }
          layers[i].style.transform = `translate3d(${rx}px, ${ry}px, 0)`
        }
      }
      return moved
    }

    return () => {
      cancelAnimationFrame(frame)
      onScreen.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [rootRef])
}
