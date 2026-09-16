import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Pauses the landing art's animations when they can't be seen or the device would
 * rather not run them. Toggles `landing-motion-paused` on the given element (see the
 * matching rule in landing.css) when the art is scrolled out of view, the tab is
 * backgrounded, or the environment signals it wants less motion/data.
 *
 * The star/rocket/glow loops and the smoke drift keep running only while Home is
 * actually on screen; everything else is static, so a hidden Home costs nothing.
 */
export function useLandingMotion(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean }
    }
    // Constrained devices opt out entirely: honor Save-Data and machines with very
    // few logical cores, where a continuous compositor loop is most likely to hurt.
    const constrained =
      nav.connection?.saveData === true ||
      (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 2)

    let onScreen = true
    const apply = () => {
      const paused = constrained || !onScreen || document.hidden
      el.classList.toggle('landing-motion-paused', paused)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        onScreen = entries[entries.length - 1]?.isIntersecting ?? true
        apply()
      },
      { threshold: 0 },
    )
    observer.observe(el)
    document.addEventListener('visibilitychange', apply)
    apply()

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', apply)
    }
  }, [ref])
}
