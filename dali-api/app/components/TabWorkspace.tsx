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

const STORAGE_KEY = 'dali:tabworkspace'

function newId() {
  return Math.random().toString(36).slice(2, 10)
}

function emptyState(): WorkspaceState {
  const paneId = newId()
  return { panes: [{ id: paneId, tabs: [], activeTabId: null }], focusedPaneId: paneId }
}

function loadState(): WorkspaceState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as WorkspaceState
    if (!parsed.panes || parsed.panes.length === 0) return emptyState()
    return parsed
  } catch {
    return emptyState()
  }
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
}

export function TabWorkspace({ initialTabs, apiRef }: TabWorkspaceProps) {
  const [state, setState] = useState<WorkspaceState>(emptyState)
  const [contextMenu, setContextMenu] = useState<
    | { paneId: string; tabId: string; x: number; y: number }
    | null
  >(null)
  const hydrated = useRef(false)

  // Hydrate from localStorage on first client render.
  useEffect(() => {
    const loaded = loadState()
    // Seed if storage is empty AND we have initial tabs
    if (loaded.panes.every((p) => p.tabs.length === 0) && initialTabs && initialTabs.length > 0) {
      const tabs = initialTabs.map((t) => ({ id: newId(), label: t.label, url: t.url }))
      const paneId = loaded.panes[0]?.id ?? newId()
      setState({
        panes: [{ id: paneId, tabs, activeTabId: tabs[0]?.id ?? null }],
        focusedPaneId: paneId,
      })
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
                p.id === existing.paneId ? { ...p, activeTabId: existing.tabId } : p,
              ),
            }
          }
          const newTab: Tab = { id: newId(), label: req.label, url: req.url }
          return {
            ...prev,
            panes: prev.panes.map((p) =>
              p.id === prev.focusedPaneId
                ? { ...p, tabs: [...p.tabs, newTab], activeTabId: newTab.id }
                : p,
            ),
          }
        })
      },
    }
  }, [apiRef])

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
      panes: prev.panes.map((p) => (p.id === paneId ? { ...p, activeTabId: tabId } : p)),
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
      const tab = sourcePane.tabs.find((t) => t.id === tabId)
      if (!tab) return prev
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
              return { ...p, tabs: [...p.tabs, tab], activeTabId: tab.id }
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
              <div className="flex-1 flex items-stretch overflow-x-auto">
                {pane.tabs.map((tab) => {
                  const isActive = tab.id === pane.activeTabId
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveTab(pane.id, tab.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setContextMenu({ paneId: pane.id, tabId: tab.id, x: e.clientX, y: e.clientY })
                      }}
                      className={`group flex items-center gap-2 px-3 border-r border-border text-xs font-medium whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-card text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
                      }`}
                    >
                      <span className="truncate max-w-[160px]">{tab.label}</span>
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
