import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type PageBarSlotName = 'actions' | 'presence'

type PageBarContextValue = {
  targets: Record<PageBarSlotName, HTMLElement | null>
  setTarget: (slot: PageBarSlotName, el: HTMLElement | null) => void
}

const PageBarContext = createContext<PageBarContextValue | null>(null)

export function PageBarSlotProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const [presence, setPresence] = useState<HTMLElement | null>(null)
  const setTarget = useCallback(
    (slot: PageBarSlotName, el: HTMLElement | null) => (slot === 'actions' ? setActions(el) : setPresence(el)),
    [],
  )
  const value = useMemo<PageBarContextValue>(
    () => ({ targets: { actions, presence }, setTarget }),
    [actions, presence, setTarget],
  )
  return <PageBarContext.Provider value={value}>{children}</PageBarContext.Provider>
}

export function NoPageBar({ children }: { children: ReactNode }) {
  return <PageBarContext.Provider value={null}>{children}</PageBarContext.Provider>
}

export function usePageBarSlot(): boolean {
  return useContext(PageBarContext) !== null
}

export function usePageBarTargetSetters() {
  const setTarget = useContext(PageBarContext)?.setTarget
  const actionsRef = useCallback((el: HTMLElement | null) => setTarget?.('actions', el), [setTarget])
  const presenceRef = useCallback((el: HTMLElement | null) => setTarget?.('presence', el), [setTarget])
  return { actionsRef, presenceRef }
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
