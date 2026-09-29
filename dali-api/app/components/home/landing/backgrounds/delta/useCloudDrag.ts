import type { RefObject } from 'react'
import { useEffect } from 'react'

/*
 * Picking a cloud up and putting it down somewhere else.
 *
 * A drag moves where a cloud sits, not where it is going. The crossing is a CSS animation and is
 * left running the whole time, so a held cloud keeps sailing the same way at the same speed, and
 * on release it carries on from wherever it was let go -- the sky is rearranged, not redirected.
 *
 * That is why the offset is written to `transform` on the same element the crossing animates.
 * `translate` and `transform` are separate properties, so the two compose without either knowing
 * about the other: the animation owns one, this owns the other, and the cloud's measured box
 * (which useCloudDrift reads to find the cursor) still says where the cloud really is.
 *
 * The offset is clamped rather than free. An unclamped drag can throw a cloud somewhere its
 * crossing never brings it back from, and a cloud you can lose is worse than one you can't quite
 * place.
 */

/** How far along its crossing a cloud may be dragged, as a share of the sky's width. */
const REACH = 0.5
/** A dragged cloud keeps at least half its own height inside the sky. */
const KEEP_IN = 0.5

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function useCloudDrag(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const cleanups: (() => void)[] = []

    for (const cloud of root.querySelectorAll<HTMLElement>('.delta-cloud')) {
      const shape = cloud.querySelector<SVGSVGElement>('.delta-cloud-shape')
      if (!shape) continue

      const offset = { x: 0, y: 0 }
      let held = -1
      let grabbed = { x: 0, y: 0 }
      let from = { x: 0, y: 0 }

      const write = () => {
        cloud.style.transform = `translate3d(${offset.x.toFixed(1)}px, ${offset.y.toFixed(1)}px, 0)`
      }

      const onDown = (e: PointerEvent) => {
        if (held !== -1 || !e.isPrimary) return
        held = e.pointerId
        grabbed = { x: e.clientX, y: e.clientY }
        from = { ...offset }
        shape.setPointerCapture(held)
        cloud.classList.add('delta-cloud-held')
        // Keeps the gesture a drag: no text selection, and no scroll on touch.
        e.preventDefault()
      }

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== held) return
        const sky = root.getBoundingClientRect()
        const box = cloud.getBoundingClientRect()
        // Where the crossing alone would have put the cloud, with this drag taken back out.
        const restingTop = box.top - sky.top - offset.y

        offset.x = clamp(from.x + (e.clientX - grabbed.x), -REACH * sky.width, REACH * sky.width)
        offset.y = clamp(
          from.y + (e.clientY - grabbed.y),
          -restingTop - box.height * KEEP_IN,
          sky.height - restingTop - box.height * KEEP_IN,
        )
        write()
      }

      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== held) return
        held = -1
        cloud.classList.remove('delta-cloud-held')
      }

      shape.addEventListener('pointerdown', onDown)
      shape.addEventListener('pointermove', onMove)
      shape.addEventListener('pointerup', onUp)
      shape.addEventListener('pointercancel', onUp)
      cleanups.push(() => {
        shape.removeEventListener('pointerdown', onDown)
        shape.removeEventListener('pointermove', onMove)
        shape.removeEventListener('pointerup', onUp)
        shape.removeEventListener('pointercancel', onUp)
      })
    }

    return () => cleanups.forEach((off) => off())
  }, [rootRef])
}
