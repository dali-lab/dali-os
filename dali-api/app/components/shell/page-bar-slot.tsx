import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type PageBarSlotName = 'status' | 'actions' | 'presence'

/** A labelled action sitting in the page bar (a page's header action, the doc toolbar). */
export function pageBarTextButton(active = false): string {
  return active
    ? 'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-os-hover-strong px-2 text-[13px] text-foreground transition-colors'
    : 'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] text-os-grey transition-colors hover:bg-os-hover hover:text-foreground'
}

type PageBarContextValue = {
  targets: Record<PageBarSlotName, HTMLElement | null>
  setTarget: (slot: PageBarSlotName, el: HTMLElement | null) => void
}

const PageBarContext = createContext<PageBarContextValue | null>(null)

type MenuItemsRegistry = {
  register: (id: string, items: ReactNode) => void
  unregister: (id: string) => void
}

const MenuItemsRegistryContext = createContext<MenuItemsRegistry | null>(null)
const MenuItemsContext = createContext<ReactNode[]>([])
export type PageBarTitleValue = {
  title: string
  onRename?: (name: string) => void | Promise<void>
  emoji?: string | null
  onEmojiChange?: (emoji: string | null) => void
}

const TitleContext = createContext<PageBarTitleValue | null>(null)
const TitleRegistryContext = createContext<((id: string, value: PageBarTitleValue | null) => void) | null>(null)
const CopyLinkHiddenContext = createContext(false)
const CopyLinkOptOutContext = createContext<((id: string, hidden: boolean) => void) | null>(null)

export function PageBarSlotProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const [presence, setPresence] = useState<HTMLElement | null>(null)
  const setTarget = useCallback((slot: PageBarSlotName, el: HTMLElement | null) => {
    if (slot === 'status') setStatus(el)
    else if (slot === 'actions') setActions(el)
    else setPresence(el)
  }, [])
  const [titleEntry, setTitleEntry] = useState<{ id: string; value: PageBarTitleValue } | null>(null)
  const registerTitle = useCallback((id: string, value: PageBarTitleValue | null) => {
    setTitleEntry((prev) => {
      if (value) return { id, value }
      return prev?.id === id ? null : prev
    })
  }, [])
  const [optOuts, setOptOuts] = useState<ReadonlySet<string>>(() => new Set())
  const setOptOut = useCallback((id: string, hidden: boolean) => {
    setOptOuts((prev) => {
      if (prev.has(id) === hidden) return prev
      const next = new Set(prev)
      if (hidden) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const [menuItems, setMenuItems] = useState<ReadonlyMap<string, ReactNode>>(() => new Map())
  const registry = useMemo<MenuItemsRegistry>(
    () => ({
      register: (id, items) => setMenuItems((prev) => new Map(prev).set(id, items)),
      unregister: (id) =>
        setMenuItems((prev) => {
          if (!prev.has(id)) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        }),
    }),
    [],
  )
  const ordered = useMemo(() => [...menuItems.values()], [menuItems])
  const value = useMemo<PageBarContextValue>(
    () => ({ targets: { status, actions, presence }, setTarget }),
    [status, actions, presence, setTarget],
  )
  return (
    <PageBarContext.Provider value={value}>
      <MenuItemsRegistryContext.Provider value={registry}>
        <MenuItemsContext.Provider value={ordered}>
          <CopyLinkOptOutContext.Provider value={setOptOut}>
            <TitleRegistryContext.Provider value={registerTitle}>
              <TitleContext.Provider value={titleEntry?.value ?? null}>
                <CopyLinkHiddenContext.Provider value={optOuts.size > 0}>{children}</CopyLinkHiddenContext.Provider>
              </TitleContext.Provider>
            </TitleRegistryContext.Provider>
          </CopyLinkOptOutContext.Provider>
        </MenuItemsContext.Provider>
      </MenuItemsRegistryContext.Provider>
    </PageBarContext.Provider>
  )
}

export function NoPageBar({ children }: { children: ReactNode }) {
  return (
    <PageBarContext.Provider value={null}>
      <MenuItemsRegistryContext.Provider value={null}>
        <CopyLinkOptOutContext.Provider value={null}>
          <TitleRegistryContext.Provider value={null}>{children}</TitleRegistryContext.Provider>
        </CopyLinkOptOutContext.Provider>
      </MenuItemsRegistryContext.Provider>
    </PageBarContext.Provider>
  )
}

/** Keeps a hidden (kept-alive) page's buttons and menu entries out of the shared page bar. */
export function PageBarVisibility({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const bar = useContext(PageBarContext)
  const registry = useContext(MenuItemsRegistryContext)
  const optOut = useContext(CopyLinkOptOutContext)
  const titleRegistry = useContext(TitleRegistryContext)
  return (
    <PageBarContext.Provider value={hidden ? null : bar}>
      <MenuItemsRegistryContext.Provider value={hidden ? null : registry}>
        <CopyLinkOptOutContext.Provider value={hidden ? null : optOut}>
          <TitleRegistryContext.Provider value={hidden ? null : titleRegistry}>{children}</TitleRegistryContext.Provider>
        </CopyLinkOptOutContext.Provider>
      </MenuItemsRegistryContext.Provider>
    </PageBarContext.Provider>
  )
}

/**
 * Entries a page adds to the page bar's single overflow menu. They render
 * inside the bar's own Menu, so they must be Menu.Item / Menu.LinkItem; state
 * a chosen item opens (a dialog) belongs in the page, not in the item.
 */
export function PageBarMenuItems({ children }: { children: ReactNode }) {
  const registry = useContext(MenuItemsRegistryContext)
  const id = useId()
  useEffect(() => {
    registry?.register(id, children)
  })
  useEffect(() => () => registry?.unregister(id), [registry, id])
  return null
}

/** Hides the shell's own "Copy link" overflow row for a page that supplies its own link action. */
export function PageBarHideCopyLink() {
  const setOptOut = useContext(CopyLinkOptOutContext)
  const id = useId()
  useEffect(() => {
    setOptOut?.(id, true)
    return () => setOptOut?.(id, false)
  }, [setOptOut, id])
  return null
}

/** Makes the page bar's last crumb the page's title: editable when `onRename` is given, with an icon picker when `onEmojiChange` is. */
export function PageBarTitle(value: PageBarTitleValue) {
  const registry = useContext(TitleRegistryContext)
  const id = useId()
  useEffect(() => {
    registry?.(id, value)
  })
  useEffect(() => () => registry?.(id, null), [registry, id])
  return null
}

export function usePageBarTitle(): PageBarTitleValue | null {
  return useContext(TitleContext)
}

export function usePageBarCopyLinkHidden(): boolean {
  return useContext(CopyLinkHiddenContext)
}

/** The page's registered overflow-menu entries, in registration order. */
export function usePageBarMenuItems(): ReactNode[] {
  return useContext(MenuItemsContext)
}

export function usePageBarSlot(): boolean {
  return useContext(PageBarContext) !== null
}

export function usePageBarTargetSetters() {
  const setTarget = useContext(PageBarContext)?.setTarget
  const statusRef = useCallback((el: HTMLElement | null) => setTarget?.('status', el), [setTarget])
  const actionsRef = useCallback((el: HTMLElement | null) => setTarget?.('actions', el), [setTarget])
  const presenceRef = useCallback((el: HTMLElement | null) => setTarget?.('presence', el), [setTarget])
  return { statusRef, actionsRef, presenceRef }
}

export function PageBarPortal({ slot, children }: { slot: PageBarSlotName; children: ReactNode }) {
  const ctx = useContext(PageBarContext)
  const target = ctx?.targets[slot] ?? null
  if (!target) return null
  return createPortal(children, target)
}

export const SHELL_HEADER_VAR = '--os-shell-header-h'

/** Publishes the sticky shell header's height so page-level sticky elements can sit under it. */
export function useShellHeaderHeight() {
  return useCallback((el: HTMLElement | null) => {
    if (!el) return
    const root = document.documentElement
    const publish = () => root.style.setProperty(SHELL_HEADER_VAR, `${el.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty(SHELL_HEADER_VAR)
    }
  }, [])
}
