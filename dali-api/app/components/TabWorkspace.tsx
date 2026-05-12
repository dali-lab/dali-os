import { useEffect, useRef, useState } from 'react'
import { X, Columns2, SplitSquareHorizontal } from 'lucide-react'

export interface OpenTabRequest {
  url: string
  label: string
}

export interface TabWorkspaceHandle {
  /** Open a tab in the focused pane, or focus it if already open anywhere. */
  openTab: (req: OpenTabRequest) => void
}

interface Tab {
  id: string
  label: string
  url: string
  lastActivatedAt: number
}

interface Pane {
  id: string
  tabs: Tab[]
  activeTabId: string | null
}

interface WorkspaceState {
  panes: Pane[]
  focusedPaneId: string
}

const STORAGE_KEY = 'dali:tabworkspace:v2'
const MAX_TABS_PER_PANE = 10

function newId() {
  return Math.random().toString(36).slice(2, 10)
}

function now() {
  return Date.now()
}

function emptyState(): WorkspaceState {
  const paneId = newId()
  return { panes: [{ id: paneId, tabs: [], activeTabId: null }], focusedPaneId: paneId }
}

function isValidState(s: unknown): s is WorkspaceState {
  if (!s || typeof s !== 'object') return false
  const v = s as WorkspaceState
  if (!Array.isArray(v.panes) || v.panes.length === 0) return false
  for (const p of v.panes) {
    if (typeof p?.id !== 'string') return false
    if (!Array.isArray(p.tabs)) return false
    for (const t of p.tabs) {
      if (
        typeof t?.id !== 'string' ||
        typeof t.label !== 'string' ||
        typeof t.url !== 'string' ||
        typeof t.lastActivatedAt !== 'number'
      )
        return false
    }
  }
  return typeof v.focusedPaneId === 'string'
}

function loadState(): WorkspaceState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw)
    if (!isValidState(parsed)) return emptyState()
    return parsed
  } catch {
    return emptyState()
  }
}

// Enforces MAX_TABS_PER_PANE by evicting the least-recently-activated tab
// (excluding `protectedTabId`, which is typically the tab we just opened).
function appendWithLruCap(tabs: Tab[], protectedTabId: string): Tab[] {
  if (tabs.length <= MAX_TABS_PER_PANE) return tabs
  let victimIdx = -1
  let victimTime = Infinity
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].id === protectedTabId) continue
    if (tabs[i].lastActivatedAt < victimTime) {
      victimTime = tabs[i].lastActivatedAt
      victimIdx = i
    }
  }
  if (victimIdx < 0) return tabs
  return [...tabs.slice(0, victimIdx), ...tabs.slice(victimIdx + 1)]
}

function findTabPane(state: WorkspaceState, url: string): { paneId: string; tabId: string } | null {
  for (const pane of state.panes) {
    const tab = pane.tabs.find((t) => t.url === url)
    if (tab) return { paneId: pane.id, tabId: tab.id }
  }
  return null
}

export interface TabWorkspaceProps {
  /** Tabs to seed the workspace with on first mount when localStorage is empty. */
  initialTabs?: OpenTabRequest[]
  /** Exposes the imperative `openTab` API to the parent. */
  apiRef?: React.MutableRefObject<TabWorkspaceHandle | null>
  /** Notified when the focused pane's active tab URL changes (null when no tab). */
  onActiveUrlChange?: (url: string | null) => void
}

interface DragSource {
  paneId: string
  tabId: string
}

interface DragOver {
  paneId: string
  /** Index in the target pane's tabs[] where the dragged tab would land. */
  index: number
}

export function TabWorkspace({ initialTabs, apiRef, onActiveUrlChange }: TabWorkspaceProps) {
  const [state, setState] = useState<WorkspaceState>(emptyState)
  const [contextMenu, setContextMenu] = useState<
    | { paneId: string; tabId: string; x: number; y: number }
    | null
  >(null)
  const hydrated = useRef(false)
  const dragSourceRef = useRef<DragSource | null>(null)
  const [dragOver, setDragOver] = useState<DragOver | null>(null)

  // Hydrate from localStorage on first client render.
  useEffect(() => {
    const loaded = loadState()
    const isEmpty = loaded.panes.every((p) => p.tabs.length === 0)
    if (isEmpty && initialTabs && initialTabs.length > 0) {
      // First-ever mount: seed both anchor + section tabs from initialTabs.
      const seedTime = now()
      const tabs = initialTabs.map((t, i) => ({
        id: newId(),
        label: t.label,
        url: t.url,
        // Stagger so the last seeded tab is the most recent (it's the active
        // one). The caller orders initial tabs from "anchor" (Home) to
        // "most specific" (the section the user actually navigated to), so
        // the last entry is what should be visible on first paint.
        lastActivatedAt: seedTime - (initialTabs.length - 1 - i),
      }))
      const paneId = loaded.panes[0]?.id ?? newId()
      setState({
        panes: [{ id: paneId, tabs, activeTabId: tabs[tabs.length - 1]?.id ?? null }],
        focusedPaneId: paneId,
      })
    } else if (!isEmpty && initialTabs && initialTabs.length > 1) {
      // Storage already has tabs. Ensure the "specific" tab from initialTabs
      // (last entry — the URL the user navigated to) is opened and focused,
      // so a direct nav to a deep link opens its section tab instead of
      // re-using whatever was active last.
      const target = initialTabs[initialTabs.length - 1]
      const existing = findTabPane(loaded, target.url)
      if (existing) {
        setState({
          ...loaded,
          focusedPaneId: existing.paneId,
          panes: loaded.panes.map((p) =>
            p.id === existing.paneId
              ? {
                  ...p,
                  activeTabId: existing.tabId,
                  tabs: p.tabs.map((t) =>
                    t.id === existing.tabId ? { ...t, lastActivatedAt: now() } : t,
                  ),
                }
              : p,
          ),
        })
      } else {
        const newTab: Tab = {
          id: newId(),
          label: target.label,
          url: target.url,
          lastActivatedAt: now(),
        }
        setState({
          ...loaded,
          panes: loaded.panes.map((p) =>
            p.id === loaded.focusedPaneId
              ? {
                  ...p,
                  tabs: appendWithLruCap([...p.tabs, newTab], newTab.id),
                  activeTabId: newTab.id,
                }
              : p,
          ),
        })
      }
    } else {
      setState(loaded)
    }
    hydrated.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on change (after first hydration).
  useEffect(() => {
    if (!hydrated.current) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ignore quota / disabled storage
    }
  }, [state])

  // Imperative API for the sidebar to open new tabs.
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      openTab: (req) => {
        setState((prev) => {
          const existing = findTabPane(prev, req.url)
          if (existing) {
            return {
              ...prev,
              focusedPaneId: existing.paneId,
              panes: prev.panes.map((p) =>
                p.id === existing.paneId
                  ? {
                      ...p,
                      activeTabId: existing.tabId,
                      tabs: p.tabs.map((t) =>
                        t.id === existing.tabId ? { ...t, lastActivatedAt: now() } : t,
                      ),
                    }
                  : p,
              ),
            }
          }
          const newTab: Tab = {
            id: newId(),
            label: req.label,
            url: req.url,
            lastActivatedAt: now(),
          }
          return {
            ...prev,
            panes: prev.panes.map((p) =>
              p.id === prev.focusedPaneId
                ? {
                    ...p,
                    tabs: appendWithLruCap([...p.tabs, newTab], newTab.id),
                    activeTabId: newTab.id,
                  }
                : p,
            ),
          }
        })
      },
    }
  }, [apiRef])

  // Notify parent when the focused pane's active tab URL changes.
  useEffect(() => {
    if (!onActiveUrlChange) return
    const pane = state.panes.find((p) => p.id === state.focusedPaneId) ?? state.panes[0]
    const tab = pane?.tabs.find((t) => t.id === pane.activeTabId) ?? null
    onActiveUrlChange(tab?.url ?? null)
  }, [state, onActiveUrlChange])

  // --- Keyboard shortcuts -------------------------------------------------
  //
  // We support shortcuts whether focus is in the outer page or inside a
  // workspace iframe. Because the iframes are same-origin we can attach a
  // listener to each iframe's contentDocument once it loads.
  //
  // Avoiding browser-claimed combos: Cmd/Ctrl+W and Cmd/Ctrl+1..9 are reserved
  // for browser-tab control and can't be reliably intercepted by a page, so
  // we use Cmd/Ctrl+Alt+... variants instead.
  //
  //   mod+alt+ArrowRight   next tab in focused pane
  //   mod+alt+ArrowLeft    previous tab in focused pane
  //   mod+alt+1 .. 9       jump to Nth tab in focused pane
  //   mod+alt+0            jump to last tab in focused pane
  //   mod+shift+k          close active tab in focused pane (mnemonic: kill)
  //   mod+\                split: open active tab to the side, or close side
  //
  // We keep the state and callbacks in a ref so the shortcut handler stays
  // stable for the lifetime of the component — that way we don't have to
  // detach/re-attach from each iframe on every state change.
  const handlersRef = useRef<{
    onShortcut: (e: KeyboardEvent) => void
  } | null>(null)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  if (!handlersRef.current) {
    handlersRef.current = {
      onShortcut: (e: KeyboardEvent) => {
        const mod = e.metaKey || e.ctrlKey
        if (!mod) return

        const s = stateRef.current
        const focusedPane = s.panes.find((p) => p.id === s.focusedPaneId) ?? s.panes[0]
        if (!focusedPane) return

        // mod + alt + arrow / number — pane navigation
        if (e.altKey && !e.shiftKey) {
          const tabs = focusedPane.tabs
          if (tabs.length === 0) return
          const activeIdx = tabs.findIndex((t) => t.id === focusedPane.activeTabId)
          const idx = activeIdx < 0 ? 0 : activeIdx

          if (e.key === 'ArrowRight') {
            e.preventDefault()
            const next = tabs[(idx + 1) % tabs.length]
            setActiveTab(focusedPane.id, next.id)
            return
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            const prev = tabs[(idx - 1 + tabs.length) % tabs.length]
            setActiveTab(focusedPane.id, prev.id)
            return
          }
          if (e.key >= '1' && e.key <= '9') {
            const n = parseInt(e.key, 10) - 1
            if (n < tabs.length) {
              e.preventDefault()
              setActiveTab(focusedPane.id, tabs[n].id)
            }
            return
          }
          if (e.key === '0') {
            e.preventDefault()
            setActiveTab(focusedPane.id, tabs[tabs.length - 1].id)
            return
          }
        }

        // mod + shift + k — close active tab
        if (e.shiftKey && (e.key === 'k' || e.key === 'K')) {
          if (focusedPane.activeTabId) {
            e.preventDefault()
            closeTab(focusedPane.id, focusedPane.activeTabId)
          }
          return
        }

        // mod + \ — toggle split
        if (!e.altKey && !e.shiftKey && e.key === '\\') {
          if (s.panes.length >= 2) {
            // Close the non-focused pane.
            const other = s.panes.find((p) => p.id !== focusedPane.id)
            if (other) {
              e.preventDefault()
              closePane(other.id)
            }
          } else if (focusedPane.activeTabId) {
            // Split the current tab out.
            e.preventDefault()
            openTabToSide(focusedPane.id, focusedPane.activeTabId)
          }
          return
        }
      },
    }
  }

  // Attach the shortcut listener to window.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => handlersRef.current?.onShortcut(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Ref-callback for each iframe: attach the shortcut listener to its
  // contentDocument so shortcuts work when focus is inside the embedded page.
  // Re-runs on each iframe load (e.g., when the user navigates a link inside
  // the iframe), at which point contentDocument is a fresh Document object.
  const onIframeLoad = (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    const doc = e.currentTarget.contentDocument
    if (!doc) return
    const handler = (ev: Event) => handlersRef.current?.onShortcut(ev as KeyboardEvent)
    // The previous document — if any — is gone with the previous navigation,
    // so its listener is gone with it. No need to remove first.
    doc.addEventListener('keydown', handler)
  }

  // Close context menu on click-anywhere.
  useEffect(() => {
    if (!contextMenu) return
    const onDocClick = () => setContextMenu(null)
    window.addEventListener('click', onDocClick)
    window.addEventListener('contextmenu', onDocClick)
    return () => {
      window.removeEventListener('click', onDocClick)
      window.removeEventListener('contextmenu', onDocClick)
    }
  }, [contextMenu])

  const setActiveTab = (paneId: string, tabId: string) => {
    setState((prev) => ({
      ...prev,
      focusedPaneId: paneId,
      panes: prev.panes.map((p) =>
        p.id === paneId
          ? {
              ...p,
              activeTabId: tabId,
              tabs: p.tabs.map((t) =>
                t.id === tabId ? { ...t, lastActivatedAt: now() } : t,
              ),
            }
          : p,
      ),
    }))
  }

  const closeTab = (paneId: string, tabId: string) => {
    setState((prev) => {
      const panes: Pane[] = []
      for (const p of prev.panes) {
        if (p.id !== paneId) {
          panes.push(p)
          continue
        }
        const idx = p.tabs.findIndex((t) => t.id === tabId)
        if (idx < 0) {
          panes.push(p)
          continue
        }
        const tabs = p.tabs.filter((t) => t.id !== tabId)
        let activeTabId = p.activeTabId
        if (activeTabId === tabId) {
          activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
        }
        panes.push({ ...p, tabs, activeTabId })
      }
      // If a pane became empty AND there's another pane, remove it.
      const nonEmpty = panes.filter((p) => p.tabs.length > 0)
      if (nonEmpty.length > 0 && nonEmpty.length < panes.length) {
        const focusedStillExists = nonEmpty.some((p) => p.id === prev.focusedPaneId)
        return {
          panes: nonEmpty,
          focusedPaneId: focusedStillExists ? prev.focusedPaneId : nonEmpty[0].id,
        }
      }
      return { ...prev, panes }
    })
  }

  const openTabToSide = (paneId: string, tabId: string) => {
    setState((prev) => {
      const sourcePane = prev.panes.find((p) => p.id === paneId)
      if (!sourcePane) return prev
      const sourceTab = sourcePane.tabs.find((t) => t.id === tabId)
      if (!sourceTab) return prev
      const tab: Tab = { ...sourceTab, lastActivatedAt: now() }
      if (prev.panes.length >= 2) {
        // Already split — move the tab to the other pane instead of creating a third.
        const otherPane = prev.panes.find((p) => p.id !== paneId)!
        return {
          ...prev,
          focusedPaneId: otherPane.id,
          panes: prev.panes.map((p) => {
            if (p.id === paneId) {
              const remaining = p.tabs.filter((t) => t.id !== tabId)
              return {
                ...p,
                tabs: remaining,
                activeTabId: p.activeTabId === tabId ? (remaining[0]?.id ?? null) : p.activeTabId,
              }
            }
            if (p.id === otherPane.id) {
              return {
                ...p,
                tabs: appendWithLruCap([...p.tabs, tab], tab.id),
                activeTabId: tab.id,
              }
            }
            return p
          }).filter((p) => p.tabs.length > 0),
        }
      }
      // Create a new pane to the right and move the tab into it.
      const newPaneId = newId()
      const remaining = sourcePane.tabs.filter((t) => t.id !== tabId)
      return {
        focusedPaneId: newPaneId,
        panes: [
          {
            ...sourcePane,
            tabs: remaining,
            activeTabId: sourcePane.activeTabId === tabId ? (remaining[0]?.id ?? null) : sourcePane.activeTabId,
          },
          { id: newPaneId, tabs: [tab], activeTabId: tab.id },
        ].filter((p) => p.tabs.length > 0 || prev.panes.length === 1) as Pane[],
      }
    })
  }

  const closePane = (paneId: string) => {
    setState((prev) => {
      if (prev.panes.length === 1) return prev
      const panes = prev.panes.filter((p) => p.id !== paneId)
      return {
        panes,
        focusedPaneId: panes[0].id,
      }
    })
  }

  // Move a tab to (targetPaneId, targetIndex). targetIndex is the insertion
  // point in the destination pane's tabs[] AFTER the source tab has been
  // removed from its origin pane — callers can pass an index computed against
  // the visible target list and we'll adjust for the within-pane case.
  const moveTab = (source: DragSource, target: { paneId: string; index: number }) => {
    setState((prev) => {
      const sourcePane = prev.panes.find((p) => p.id === source.paneId)
      if (!sourcePane) return prev
      const tab = sourcePane.tabs.find((t) => t.id === source.tabId)
      if (!tab) return prev

      const sameP = source.paneId === target.paneId
      if (sameP) {
        const fromIdx = sourcePane.tabs.findIndex((t) => t.id === source.tabId)
        // If dropping where it already is (or just after itself), no-op.
        if (target.index === fromIdx || target.index === fromIdx + 1) return prev
        const without = sourcePane.tabs.filter((t) => t.id !== source.tabId)
        // Adjust index since we removed an earlier element.
        const adjustedIdx = target.index > fromIdx ? target.index - 1 : target.index
        const next = [
          ...without.slice(0, adjustedIdx),
          tab,
          ...without.slice(adjustedIdx),
        ]
        return {
          ...prev,
          panes: prev.panes.map((p) =>
            p.id === source.paneId ? { ...p, tabs: next, activeTabId: tab.id } : p,
          ),
          focusedPaneId: source.paneId,
        }
      }

      // Cross-pane move.
      const mapped = prev.panes.map((p) => {
        if (p.id === source.paneId) {
          const tabs = p.tabs.filter((t) => t.id !== source.tabId)
          return {
            ...p,
            tabs,
            activeTabId:
              p.activeTabId === source.tabId ? (tabs[0]?.id ?? null) : p.activeTabId,
          }
        }
        if (p.id === target.paneId) {
          const inserted = [
            ...p.tabs.slice(0, target.index),
            tab,
            ...p.tabs.slice(target.index),
          ]
          return {
            ...p,
            tabs: appendWithLruCap(inserted, tab.id),
            activeTabId: tab.id,
          }
        }
        return p
      })
      // Drop emptied panes unless we'd be left with zero.
      const nonEmpty = mapped.filter((p) => p.tabs.length > 0)
      const panes = nonEmpty.length > 0 ? nonEmpty : mapped.slice(0, 1)

      return {
        panes,
        focusedPaneId: target.paneId,
      }
    })
  }

  return (
    <div className="flex-1 flex min-h-0">
      {state.panes.map((pane, idx) => {
        const isFocused = pane.id === state.focusedPaneId
        const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0]
        const showLeftBorder = idx > 0
        return (
          <div
            key={pane.id}
            className={`flex-1 min-w-0 flex flex-col ${showLeftBorder ? 'border-l border-border' : ''}`}
            onClick={() =>
              !isFocused && setState((prev) => ({ ...prev, focusedPaneId: pane.id }))
            }
          >
            {/* Tab bar */}
            <div className="flex items-stretch h-10 bg-section-bg border-b border-border">
              <div
                className="flex-1 flex items-stretch overflow-x-auto"
                onDragOver={(e) => {
                  // Allow drop on the empty area at the end of the strip.
                  if (dragSourceRef.current) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    const current = dragOver
                    if (current?.paneId !== pane.id || current.index !== pane.tabs.length) {
                      setDragOver({ paneId: pane.id, index: pane.tabs.length })
                    }
                  }
                }}
                onDrop={(e) => {
                  if (!dragSourceRef.current) return
                  e.preventDefault()
                  const src = dragSourceRef.current
                  const tgt = dragOver ?? { paneId: pane.id, index: pane.tabs.length }
                  moveTab(src, tgt)
                  dragSourceRef.current = null
                  setDragOver(null)
                }}
              >
                {pane.tabs.map((tab, tabIdx) => {
                  const isActive = tab.id === pane.activeTabId
                  const indicatorBefore =
                    dragOver?.paneId === pane.id && dragOver.index === tabIdx
                  const indicatorAfter =
                    dragOver?.paneId === pane.id &&
                    dragOver.index === tabIdx + 1 &&
                    tabIdx === pane.tabs.length - 1
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      draggable
                      onDragStart={(e) => {
                        dragSourceRef.current = { paneId: pane.id, tabId: tab.id }
                        e.dataTransfer.effectAllowed = 'move'
                        // Firefox requires some dataTransfer data to start a drag.
                        try {
                          e.dataTransfer.setData('text/plain', tab.id)
                        } catch {
                          // ignore
                        }
                      }}
                      onDragEnd={() => {
                        dragSourceRef.current = null
                        setDragOver(null)
                      }}
                      onDragOver={(e) => {
                        if (!dragSourceRef.current) return
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'move'
                        const rect = e.currentTarget.getBoundingClientRect()
                        const midpoint = rect.left + rect.width / 2
                        const insertIdx = e.clientX < midpoint ? tabIdx : tabIdx + 1
                        if (
                          dragOver?.paneId !== pane.id ||
                          dragOver.index !== insertIdx
                        ) {
                          setDragOver({ paneId: pane.id, index: insertIdx })
                        }
                      }}
                      onDrop={(e) => {
                        if (!dragSourceRef.current) return
                        e.preventDefault()
                        e.stopPropagation()
                        const src = dragSourceRef.current
                        const tgt = dragOver ?? { paneId: pane.id, index: tabIdx }
                        moveTab(src, tgt)
                        dragSourceRef.current = null
                        setDragOver(null)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveTab(pane.id, tab.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu({ paneId: pane.id, tabId: tab.id, x: e.clientX, y: e.clientY })
                      }}
                      className={`group relative flex items-center gap-2 px-3 border-r border-border text-xs font-medium whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-card text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                      } ${indicatorBefore ? 'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent-coral' : ''} ${indicatorAfter ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-0.5 after:bg-accent-coral' : ''}`}
                    >
                      <span className="truncate max-w-[160px] pointer-events-none">{tab.label}</span>
                      <span
                        role="button"
                        aria-label={`Close ${tab.label}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(pane.id, tab.id)
                        }}
                        className="p-0.5 rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted opacity-60 group-hover:opacity-100"
                      >
                        <X className="w-3 h-3" />
                      </span>
                    </button>
                  )
                })}
                {pane.tabs.length === 0 && (
                  <div className="px-3 flex items-center text-xs text-muted-foreground/60">
                    No tabs open. Click a section in the sidebar.
                  </div>
                )}
              </div>
              {state.panes.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    closePane(pane.id)
                  }}
                  title="Close pane"
                  aria-label="Close pane"
                  className="px-2 text-muted-foreground/70 hover:text-foreground hover:bg-muted border-l border-border"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* iframe content */}
            <div className="flex-1 min-h-0 bg-section-bg">
              {activeTab ? (
                <iframe
                  key={activeTab.id}
                  src={addEmbedParam(activeTab.url)}
                  title={activeTab.label}
                  className="w-full h-full border-0"
                  onLoad={onIframeLoad}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground/60 text-sm">
                  No content
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[180px] text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              openTabToSide(contextMenu.paneId, contextMenu.tabId)
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-left"
          >
            {state.panes.length >= 2 ? (
              <>
                <Columns2 className="w-3.5 h-3.5" />
                Move to other pane
              </>
            ) : (
              <>
                <SplitSquareHorizontal className="w-3.5 h-3.5" />
                Open to the side
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              closeTab(contextMenu.paneId, contextMenu.tabId)
              setContextMenu(null)
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-left text-foreground"
          >
            <X className="w-3.5 h-3.5" />
            Close tab
          </button>
        </div>
      )}
    </div>
  )
}

function addEmbedParam(url: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}embed=1`
}
