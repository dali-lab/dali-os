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

export function isVersionHistoryShortcut(e: KeyEventLike): boolean {
  return (
    !e.defaultPrevented &&
    (e.metaKey || e.ctrlKey) &&
    e.shiftKey &&
    e.altKey &&
    (e.code === 'KeyH' || e.key.toLowerCase() === 'h')
  )
}
