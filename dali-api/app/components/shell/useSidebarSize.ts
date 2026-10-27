import { useEffect, useState } from 'react'
import type { SidebarSize } from '~/components/shell/rail-model'

const NARROW_QUERY = '(max-width: 1279px)'

/**
 * Automatic sidebar size: narrower desktops get the compact icon column, wide
 * ones the full rail. `instant` is true when the current size should land
 * without the width animation — on the hydration correction (the server always
 * renders expanded).
 */
export function useSidebarSize(enabled: boolean) {
  const [size, setSize] = useState<SidebarSize>('expanded')
  const [instant, setInstant] = useState(true)

  useEffect(() => {
    if (!enabled) return
    const mq = window.matchMedia(NARROW_QUERY)
    setInstant(true)
    setSize(mq.matches ? 'compact' : 'expanded')
    const onChange = (e: MediaQueryListEvent) => {
      setInstant(false)
      setSize(e.matches ? 'compact' : 'expanded')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [enabled])

  return { size: enabled ? size : ('expanded' as SidebarSize), instant }
}
