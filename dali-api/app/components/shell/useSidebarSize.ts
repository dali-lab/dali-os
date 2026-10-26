import { useCallback, useEffect, useRef, useState } from 'react'
import type { SidebarSize } from '~/components/shell/rail-model'

const STORAGE_KEY = 'dali:rail:size'
const NARROW_QUERY = '(max-width: 1279px)'

export type SidebarToggleSource = 'pointer' | 'keyboard'

function readStored(fallback: SidebarSize): SidebarSize {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    return v === 'expanded' || v === 'compact' ? v : fallback
  } catch {
    return fallback
  }
}

function isNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches
}

/**
 * Sidebar size with three inputs: the user's saved preference, an automatic
 * compact state on narrower desktops, and the ⌘\ shortcut. `instant` is true
 * when the current size should land without the width animation — on the
 * hydration correction (the server always renders expanded) and on keyboard
 * toggles.
 */
export function useSidebarSize(enabled: boolean) {
  const [size, setSize] = useState<SidebarSize>('expanded')
  const [instant, setInstant] = useState(true)
  const preferredRef = useRef<SidebarSize>('expanded')
  const sizeRef = useRef(size)
  sizeRef.current = size

  useEffect(() => {
    if (!enabled) return
    preferredRef.current = readStored('expanded')
    setInstant(true)
    setSize(isNarrow() ? 'compact' : preferredRef.current)
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      setInstant(false)
      setSize(e.matches ? 'compact' : preferredRef.current)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [enabled])

  const toggle = useCallback((source: SidebarToggleSource = 'pointer') => {
    const next: SidebarSize = sizeRef.current === 'expanded' ? 'compact' : 'expanded'
    setInstant(source === 'keyboard')
    setSize(next)
    if (!isNarrow()) {
      preferredRef.current = next
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* storage unavailable */
      }
    }
  }, [])

  return { size: enabled ? size : ('expanded' as SidebarSize), toggle, instant }
}
