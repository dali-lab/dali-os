import type { ComponentType, LazyExoticComponent } from 'react'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { LandingBackgroundId } from './schedule'

/*
 * Each background (art, CSS, scripts) is its own chunk, so Home only downloads the live
 * one no matter how many are kept around. It mounts after hydration, like DocEditor: CSS
 * from a lazy chunk isn't in the server-rendered <head>, so rendering it during SSR would
 * flash unstyled art. The page's dark ground shows until the chunk arrives, and each
 * background's own load-in plays from there.
 */
const BACKGROUNDS: Record<LandingBackgroundId, LazyExoticComponent<ComponentType>> = {
  // Its styles are the unscoped art rules in landing.css.
  'deep-space': lazy(() =>
    import('../LandingArt').then(({ LandingSky, LandingStage }) => ({
      default: () => (
        <>
          <LandingSky />
          <LandingStage />
        </>
      ),
    })),
  ),
  library: lazy(() => import('./library/LibraryBackground')),
}

export default function LandingBackground({ id }: { id: LandingBackgroundId }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const Background = BACKGROUNDS[id]
  return (
    <Suspense fallback={null}>
      <Background />
    </Suspense>
  )
}
