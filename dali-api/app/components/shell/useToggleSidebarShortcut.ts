import { useEffect, useRef } from 'react'
import { isToggleSidebarShortcut } from '~/lib/shortcuts'

export function useToggleSidebarShortcut(enabled: boolean, toggle: () => void) {
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleSidebarShortcut(e)) return
      e.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
