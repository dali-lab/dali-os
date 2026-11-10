type KeyEventLike = {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  key: string
  code?: string
  defaultPrevented?: boolean
  target?: EventTarget | null
}

export const COMMAND_K_SHORTCUT = '⌘K'
export const TOGGLE_SIDEBAR_SHORTCUT = '⌘\\'
export const COPY_LINK_SHORTCUT = '⌘⇧C'
export const FAVORITE_SHORTCUT = '⌘D'
export const FIND_SHORTCUT = '⌘F'
export const VERSION_HISTORY_SHORTCUT = '⌘⌥⇧H'
export const ASK_SHORTCUT = '⌘J'

const EDITING_SURFACE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .bn-editor, .ProseMirror'

export function isEditingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as { closest?: (selector: string) => Element | null } | null | undefined
  return typeof el?.closest === 'function' && el.closest(EDITING_SURFACE) !== null
}

/** Backspace outside any editable surface, which WebKit treats as "go back a page". */
export function isBackspaceNavigation(e: KeyEventLike): boolean {
  return e.key === 'Backspace' && !isEditingTarget(e.target)
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
}

/** ⌘ on a Mac, where Ctrl belongs to the system's text editing keys (⌃K, ⌃D); Ctrl elsewhere. */
export function modKey(e: Pick<KeyEventLike, 'metaKey' | 'ctrlKey'>): boolean {
  return e.metaKey || (e.ctrlKey && !isMac())
}

function modOnly(e: KeyEventLike): boolean {
  return modKey(e) && !e.shiftKey && !e.altKey
}

export function isCommandKShortcut(e: KeyEventLike): boolean {
  return modOnly(e) && (e.key === 'k' || e.key === 'K')
}

export function isAskShortcut(e: KeyEventLike): boolean {
  return !e.defaultPrevented && modOnly(e) && (e.code === 'KeyJ' || e.key === 'j' || e.key === 'J')
}

export function isFavoriteShortcut(e: KeyEventLike): boolean {
  return modOnly(e) && (e.key === 'd' || e.key === 'D')
}

export function isFindShortcut(e: KeyEventLike): boolean {
  return modKey(e) && e.key === 'f'
}

export function isCopyPageLinkShortcut(e: KeyEventLike): boolean {
  return modKey(e) && e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C')
}

export function isToggleSidebarShortcut(e: KeyEventLike): boolean {
  return !e.defaultPrevented && modOnly(e) && e.key === '\\'
}

export function isVersionHistoryShortcut(e: KeyEventLike): boolean {
  return (
    !e.defaultPrevented &&
    modKey(e) &&
    e.shiftKey &&
    e.altKey &&
    (e.code === 'KeyH' || e.key.toLowerCase() === 'h')
  )
}

/** Which way a keypress moves through the desktop tabs, or null if it doesn't. */
export function tabCycleShortcut(e: KeyEventLike): 1 | -1 | null {
  if (e.key === 'Tab') {
    if (!e.ctrlKey || e.metaKey || e.altKey) return null
    return e.shiftKey ? -1 : 1
  }
  if (!modKey(e)) return null
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

/** Back or forward through page history. ⌥ arrows move by word while typing, so they yield to text fields. */
export function historyShortcut(e: KeyEventLike): 'back' | 'forward' | null {
  if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (isEditingTarget(e.target)) return null
    if (e.key === 'ArrowLeft') return 'back'
    if (e.key === 'ArrowRight') return 'forward'
    return null
  }
  if (!modOnly(e)) return null
  if (e.key === '[') return 'back'
  if (e.key === ']') return 'forward'
  return null
}

/**
 * Copying or applying a selection's formatting in a doc. Applying needs a copy
 * waiting, and uses it up, so ⌘⇧V otherwise stays paste without formatting.
 */
export function paintFormatShortcut(
  e: KeyEventLike,
  opts: { selection: boolean; copied: boolean },
): 'copy' | 'apply' | null {
  if (!modKey(e) || !e.shiftKey || e.altKey || !opts.selection) return null
  const key = e.key.toLowerCase()
  if (key === 'c') return 'copy'
  return key === 'v' && opts.copied ? 'apply' : null
}

export type ShortcutRow = { keys: string; action: string }
export type ShortcutSection = { title: string; note?: string; rows: ShortcutRow[] }

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'General',
    rows: [
      { keys: COMMAND_K_SHORTCUT, action: 'Open the command palette to search people, projects, and docs, and run commands' },
      { keys: '⌘↵', action: 'In the command palette, open the result beside the page' },
      { keys: TOGGLE_SIDEBAR_SHORTCUT, action: 'Show or hide the sidebar' },
      { keys: FAVORITE_SHORTCUT, action: 'Favorite the page' },
      { keys: COPY_LINK_SHORTCUT, action: 'Copy a link to the page' },
    ],
  },
  {
    title: 'Desktop app tabs',
    rows: [
      { keys: '⌘T', action: 'New tab' },
      { keys: '⌘W', action: 'Close the tab' },
      { keys: '⌘⇧K', action: 'Close the tab' },
      { keys: '⌘⇧T', action: 'Reopen the last closed tab' },
      { keys: '⌘⇧]', action: 'Next tab' },
      { keys: '⌘⇧[', action: 'Previous tab' },
      { keys: 'Ctrl Tab', action: 'Next tab' },
      { keys: 'Ctrl ⇧ Tab', action: 'Previous tab' },
      { keys: '⌘⌥→', action: 'Next tab' },
      { keys: '⌘⌥←', action: 'Previous tab' },
      { keys: '⌘1–8', action: 'Jump to that tab' },
      { keys: '⌘9', action: 'Jump to the last tab' },
    ],
  },
  {
    title: 'Desktop app navigation',
    rows: [
      { keys: '⌘[', action: 'Back' },
      { keys: '⌘]', action: 'Forward' },
      { keys: '⌥←', action: 'Back, unless you are typing' },
      { keys: '⌥→', action: 'Forward, unless you are typing' },
      { keys: 'Mouse back/forward', action: 'Back and forward with the thumb buttons' },
      { keys: FIND_SHORTCUT, action: 'Find on the page' },
      { keys: '⌘G', action: 'Find next' },
      { keys: '⌘⇧G', action: 'Find previous' },
      { keys: '⌘R', action: 'Reload' },
      { keys: '⌘=', action: 'Zoom in' },
      { keys: '⌘-', action: 'Zoom out' },
      { keys: '⌘0', action: 'Actual size' },
      { keys: '⌘⇧W', action: 'Close the window' },
    ],
  },
  {
    title: 'Docs',
    rows: [
      { keys: '⌘B', action: 'Bold' },
      { keys: '⌘I', action: 'Italic' },
      { keys: '⌘U', action: 'Underline' },
      { keys: COMMAND_K_SHORTCUT, action: 'With text selected, add or edit a link' },
      { keys: FIND_SHORTCUT, action: 'Find and replace' },
      { keys: COPY_LINK_SHORTCUT, action: 'With text selected, copy its formatting' },
      { keys: '⌘⇧V', action: 'With formatting copied, apply it to the selected text' },
      { keys: VERSION_HISTORY_SHORTCUT, action: 'Version history' },
    ],
  },
  {
    title: 'Calendar',
    rows: [
      { keys: 'D', action: 'Day view' },
      { keys: 'W', action: 'Week view' },
      { keys: 'M', action: 'Month view' },
      { keys: 'A', action: 'Agenda view' },
      { keys: 'T', action: 'Go to today' },
      { keys: '←', action: 'Previous period' },
      { keys: '→', action: 'Next period' },
    ],
  },
  {
    title: 'Drive',
    rows: [
      { keys: '↑ ↓', action: 'Move through items' },
      { keys: '↵', action: 'Open the item' },
      { keys: 'Space', action: 'Preview the item' },
      { keys: '⌫', action: 'Go up a folder' },
      { keys: '⌘↑', action: 'Go up a folder' },
      { keys: '⌘⌫', action: 'Move the selection to trash' },
      { keys: 'Delete', action: 'Move the selection to trash' },
      { keys: 'F2', action: 'Rename the item' },
      { keys: '⌘A', action: 'Select everything' },
      { keys: '⌘Z', action: 'Undo' },
      { keys: '⌘⇧Z', action: 'Redo' },
      { keys: 'Esc', action: 'Clear the selection' },
      { keys: 'Letters', action: 'Jump to an item by typing its name' },
    ],
  },
]
