type KeyEventLike = {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
  code?: string
  defaultPrevented?: boolean
}

export const TOGGLE_SIDEBAR_SHORTCUT = '⌘\\'
export const VERSION_HISTORY_SHORTCUT = '⌘⌥⇧H'

export function isToggleSidebarShortcut(e: KeyEventLike): boolean {
  return (
    !e.defaultPrevented && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '\\'
  )
}

/** Which way a keypress moves through the desktop tabs, or null if it doesn't. */
export function tabCycleShortcut(e: KeyEventLike): 1 | -1 | null {
  if (e.key === 'Tab') {
    if (!e.ctrlKey || e.metaKey || e.altKey) return null
    return e.shiftKey ? -1 : 1
  }
  if (!(e.metaKey || e.ctrlKey)) return null
  if (e.altKey && !e.shiftKey) {
    if (e.key === 'ArrowRight') return 1
    if (e.key === 'ArrowLeft') return -1
  }
  if (e.shiftKey && !e.altKey) {
    if (e.key === ']' || e.key === '}') return 1
    if (e.key === '[' || e.key === '{') return -1
  }
  return null
}

export function isVersionHistoryShortcut(e: KeyEventLike): boolean {
  return (
    !e.defaultPrevented &&
    (e.metaKey || e.ctrlKey) &&
    e.shiftKey &&
    e.altKey &&
    (e.code === 'KeyH' || e.key.toLowerCase() === 'h')
  )
}
