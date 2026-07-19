import { useEffect, useRef, useState } from 'react'
import { X, Maximize2, SplitSquareHorizontal, Loader2, ChevronLeft, ChevronRight, Copy, Pin, PinOff, ChevronDown } from 'lucide-react'

export interface OpenTabRequest {
  url: string
  label: string
}

export interface TabWorkspaceHandle {
  /** Open a tab in the focused pane, or focus it if already open anywhere.
   *  Pass { ephemeral: true } for a preview tab: it reuses the focused pane's
   *  single preview slot instead of stacking, so casual browsing from the
   *  sidebar never piles up tabs. */
  openTab: (req: OpenTabRequest, opts?: { ephemeral?: boolean }) => void
  /** Open a tab in the focused pane WITHOUT switching to it. Used by
   *  sidebar middle-click to open a section in the background, matching
   *  browser-tab middle-click behaviour. If the tab is already open it
   *  stays where it is and the user's current focus isn't disturbed. */
  openTabInBackground: (req: OpenTabRequest) => void
  /** Open a tab in a second pane to the side (splitting if there's only one
   *  pane), or focus it if already open there. Used by the sidebar's
   *  right-click "Open to the side". */
  openTabToSide: (req: OpenTabRequest) => void
  /** Rename any tab matching `url` (across all panes). Used by embedded
   *  iframes to announce their preferred label after route meta resolves. */
  setTabLabel: (url: string, label: string) => void
  /** Post a message to every open tab's iframe (across all panes). Used to
   *  relay a data-changed event from the iframe that made the change to
   *  sibling iframes that show the same data (e.g. a doc title edit in a
   *  split-screen document tab refreshing the project tab's Documents list). */
  broadcast: (message: Record<string, unknown>) => void
}

interface Tab {
  id: string
  label: string
  // Where the tab's iframe currently is. Drifts as the user navigates links
  // inside the iframe (kept in sync via the `dali:tabNavigated` message), and
  // is persisted so reopening the workspace restores the last page viewed.
  // NOT fed back into the live iframe's src — see `seedUrlsRef` — so updating
  // it never reloads the iframe and loses its back/forward history.
  url: string
  // The section URL the tab was opened from (e.g. /hiring/reviewer). Stable
  // for the tab's life. Used to dedupe sidebar clicks so re-clicking a section
  // focuses the already-open tab even after it has drifted to a sub-page.
  origin: string
  lastActivatedAt: number
  // Browser-style per-tab history. backStack[last] is the most recent prior
  // url; forwardStack[last] is the next url if the user clicks forward. A
  // brand-new navigation clears forwardStack. Capped at HISTORY_CAP so a
  // long-lived tab can't blow up localStorage.
  backStack: string[]
  forwardStack: string[]
  // Pinned tabs cluster at the left of the pane, render compact, never get
  // evicted or pushed into the overflow menu, and survive "Close others /
  // Close unpinned". Toggled from the tab context menu.
  pinned: boolean
  // Ephemeral (preview) tabs are opened by a single sidebar click into ONE
  // reusable slot per pane — opening another section replaces this tab instead
  // of stacking. Promoted to a kept tab (ephemeral:false) on double-click,
  // in-tab navigation, or pin. Rendered in italics.
  ephemeral: boolean
}

interface Pane {
  id: string
  tabs: Tab[]
  activeTabId: string | null
}

interface ClosedTab {
  label: string
  url: string
  origin: string
  backStack: string[]
  forwardStack: string[]
  closedAt: number
}

interface WorkspaceState {
  panes: Pane[]
  focusedPaneId: string
  // LRU of recently-closed tabs (most-recent last). Capped at CLOSED_CAP so a
  // long-lived session can't grow this without bound. Reopened via mod+shift+T.
  closedTabs: ClosedTab[]
}

const STORAGE_KEY = 'dali:tabworkspace:v4'
// Hard backstop on tabs per pane. Unpinned tabs that don't fit collapse into the
// overflow menu rather than being evicted, so this cap is generous and mostly a
// runaway guard; pinned tabs never count toward eviction (see appendWithLruCap).
const MAX_TABS_PER_PANE = 20
const HISTORY_CAP = 50
const CLOSED_CAP = 10
// Fixed pixel widths used to compute how many unpinned tabs fit in a pane's tab
// strip before the rest collapse into the overflow menu. Unpinned tabs render
// at a fixed width so the fit math is exact; pinned tabs are compact (pin icon +
// short label). Tuned to the padding/typography below.
const TAB_W = 168
const PINNED_TAB_W = 128
const OVERFLOW_BTN_W = 52

function newId() {
  return Math.random().toString(36).slice(2, 10)
}

function now() {
  return Date.now()
}

function emptyState(): WorkspaceState {
  const paneId = newId()
  return {
    panes: [{ id: paneId, tabs: [], activeTabId: null }],
    focusedPaneId: paneId,
    closedTabs: [],
  }
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
        typeof t.lastActivatedAt !== 'number' ||
        !Array.isArray(t.backStack) ||
        !Array.isArray(t.forwardStack) ||
        t.backStack.some((u) => typeof u !== 'string') ||
        t.forwardStack.some((u) => typeof u !== 'string')
      )
        return false
    }
  }
  if (typeof v.focusedPaneId !== 'string') return false
  // `closedTabs` is optional for forward-compat with v4 entries written before
  // this field existed; loadState backfills it to [].
  if (v.closedTabs !== undefined) {
    if (!Array.isArray(v.closedTabs)) return false
    for (const c of v.closedTabs) {
      if (
        typeof c?.label !== 'string' ||
        typeof c.url !== 'string' ||
        typeof c.origin !== 'string' ||
        typeof c.closedAt !== 'number' ||
        !Array.isArray(c.backStack) ||
        !Array.isArray(c.forwardStack)
      )
        return false
    }
  }
  return true
}

function loadState(): WorkspaceState {
  if (typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw)
    if (!isValidState(parsed)) return emptyState()
    // `origin` was added after `url`; backfill it from `url` for any tab
    // persisted before the field existed so dedup/highlighting keep working.
    return {
      ...parsed,
      panes: parsed.panes.map((p) => ({
        ...p,
        // Backfill fields added after v4 shipped (origin, pinned, ephemeral) so
        // tabs persisted by older builds keep working without a storage reset.
        tabs: p.tabs.map((t) => ({
          ...t,
          origin: t.origin ?? t.url,
          pinned: t.pinned ?? false,
          ephemeral: t.ephemeral ?? false,
        })),
      })),
      closedTabs: Array.isArray(parsed.closedTabs) ? parsed.closedTabs : [],
    }
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
    if (tabs[i].pinned) continue // pinned tabs are never evicted
    if (tabs[i].lastActivatedAt < victimTime) {
      victimTime = tabs[i].lastActivatedAt
      victimIdx = i
    }
  }
  if (victimIdx < 0) return tabs
  return [...tabs.slice(0, victimIdx), ...tabs.slice(victimIdx + 1)]
}

// Stable partition keeping pinned tabs first (in their relative order) followed
// by unpinned tabs (in theirs). Run after any pin/unpin or tab move so the array
// order — which drives left-to-right render order — always shows pins on the
// left, matching the VS Code / browser convention.
function normalize(tabs: Tab[]): Tab[] {
  const pinned = tabs.filter((t) => t.pinned)
  const unpinned = tabs.filter((t) => !t.pinned)
  return pinned.length === 0 ? tabs : [...pinned, ...unpinned]
}

// Split a pane's tabs into the pinned cluster, the unpinned tabs that fit inline
// at the given strip width, and the rest (overflow). Visibility membership is by
// recency so the active tab (always most-recently-activated) is never hidden;
// callers render `visible` in positional order so tabs don't shuffle on click.
// width === 0 (not measured yet) shows everything — overflow kicks in on measure.
function splitVisibleOverflow(
  tabs: Tab[],
  width: number,
): { pinned: Tab[]; visible: Tab[]; overflow: Tab[] } {
  const pinned = tabs.filter((t) => t.pinned)
  const unpinned = tabs.filter((t) => !t.pinned)
  if (width <= 0 || unpinned.length === 0) return { pinned, visible: unpinned, overflow: [] }
  const availBase = width - pinned.length * PINNED_TAB_W
  if (unpinned.length * TAB_W <= availBase) return { pinned, visible: unpinned, overflow: [] }
  const cap = Math.max(1, Math.floor((availBase - OVERFLOW_BTN_W) / TAB_W))
  if (cap >= unpinned.length) return { pinned, visible: unpinned, overflow: [] }
  const recentIds = new Set(
    [...unpinned]
      .sort((a, b) => b.lastActivatedAt - a.lastActivatedAt)
      .slice(0, cap)
      .map((t) => t.id),
  )
  return {
    pinned,
    visible: unpinned.filter((t) => recentIds.has(t.id)),
    overflow: unpinned.filter((t) => !recentIds.has(t.id)),
  }
}

// Locate an open tab whose current url matches `url`. Re-clicking a sidebar
// section while a tab opened from that section has drifted to a sub-page
// (e.g. a cycle detail under Cycles) intentionally does NOT match — the user
// gets a fresh tab on the section page rather than being snapped to the
// drifted child, which lets them keep both views side-by-side.
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
  /** ⌘/Ctrl+K — open the command palette. Called for keypresses in the shell
   *  window and inside any workspace iframe (the shortcut handler is attached
   *  to both), so the palette opens wherever focus is. */
  onOpenPalette?: () => void
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

// Drop target when a tab is dragged over a pane's content area (not its tab
// strip). The cursor's horizontal position selects a zone: the edge bands
// split the workspace, the middle moves the tab into that pane.
type PaneDropZone = 'split-left' | 'split-right' | 'center'

interface PaneDrop {
  paneId: string
  zone: PaneDropZone
}

export function TabWorkspace({ initialTabs, apiRef, onActiveUrlChange, onOpenPalette }: TabWorkspaceProps) {
  const [state, setState] = useState<WorkspaceState>(emptyState)
  const [contextMenu, setContextMenu] = useState<
    | { paneId: string; tabId: string; x: number; y: number }
    | null
  >(null)
  // Right-click menu on a back/forward arrow → list of stack entries.
  const [historyMenu, setHistoryMenu] = useState<
    | { paneId: string; side: 'back' | 'forward'; x: number; y: number }
    | null
  >(null)
  // Click on a pane's overflow "+N" button → dropdown of its hidden tabs.
  const [overflowMenu, setOverflowMenu] = useState<
    | { paneId: string; x: number; y: number }
    | null
  >(null)
  const hydrated = useRef(false)
  const dragSourceRef = useRef<DragSource | null>(null)
  const [dragOver, setDragOver] = useState<DragOver | null>(null)
  // True while a tab drag is in flight. Used to mount the content-area drop
  // overlays only during a drag (iframes swallow native drag events, so the
  // pane body can't receive dragover/drop without an overlay on top).
  const [isDragging, setIsDragging] = useState(false)
  const [paneDrop, setPaneDrop] = useState<PaneDrop | null>(null)
  // Tabs whose iframes are kept alive in the DOM. Switching tabs toggles
  // visibility instead of unmounting, so scroll/form/JS state is preserved.
  // Lazy-mount on first activation — avoids slamming the server on hydrate
  // when many tabs were persisted across sessions.
  const [mountedTabIds, setMountedTabIds] = useState<Set<string>>(() => new Set())
  // Tab ids whose iframe document has finished its initial load. Drives the
  // per-pane loading overlay: a mounted-but-not-yet-loaded tab shows a spinner
  // until its iframe's onLoad fires. (In-iframe React Router navigations are
  // covered separately by the root NavigationProgress bar.)
  const [loadedTabIds, setLoadedTabIds] = useState<Set<string>>(() => new Set())

  // Measured inner width of each pane's tab strip (drives how many unpinned tabs
  // fit before the rest collapse into the overflow menu). Keyed by pane id.
  const [paneWidths, setPaneWidths] = useState<Record<string, number>>({})
  const stripObservers = useRef<Map<string, ResizeObserver>>(new Map())
  const stripRefCbs = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  // One stable ResizeObserver-backed ref callback per pane id, so attaching it
  // to the strip element doesn't tear down/re-observe on every render.
  const stripRefCb = (paneId: string) => {
    let cb = stripRefCbs.current.get(paneId)
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        const prevOb = stripObservers.current.get(paneId)
        if (prevOb) {
          prevOb.disconnect()
          stripObservers.current.delete(paneId)
        }
        if (el && typeof ResizeObserver !== 'undefined') {
          const ob = new ResizeObserver((entries) => {
            const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth)
            setPaneWidths((prev) => (prev[paneId] === w ? prev : { ...prev, [paneId]: w }))
          })
          ob.observe(el)
          stripObservers.current.set(paneId, ob)
          setPaneWidths((prev) => ({ ...prev, [paneId]: Math.round(el.clientWidth) }))
        }
      }
      stripRefCbs.current.set(paneId, cb)
    }
    return cb
  }
  useEffect(() => {
    const observers = stripObservers.current
    return () => {
      for (const ob of observers.values()) ob.disconnect()
      observers.clear()
    }
  }, [])

  // The URL each iframe was mounted with. Captured once per tab (the first
  // time it mounts) and used as the iframe `src`, so updating the tab's live
  // `url` as the user navigates inside the iframe never re-points `src` and
  // reloads the frame (which would wipe its back/forward history). A fresh
  // page load re-seeds from the persisted `url`, restoring the last page.
  const seedUrlsRef = useRef<Map<string, string>>(new Map())
  const seedFor = (tab: Tab): string => {
    const existing = seedUrlsRef.current.get(tab.id)
    if (existing !== undefined) return existing
    seedUrlsRef.current.set(tab.id, tab.url)
    return tab.url
  }

  // Stable `title` for each iframe, captured at first mount. The visible tab
  // label can be refined by `setTabLabel` as the iframe navigates, but the
  // iframe's `title` attribute is the section's identity (e.g. "Cycles") and
  // must NOT shift under it — both so it reads consistently and so anything
  // addressing the frame by title stays valid across in-tab navigation.
  const seedTitlesRef = useRef<Map<string, string>>(new Map())
  const titleFor = (tab: Tab): string => {
    const existing = seedTitlesRef.current.get(tab.id)
    if (existing !== undefined) return existing
    seedTitlesRef.current.set(tab.id, tab.label)
    return tab.label
  }

  // tabId → its <iframe>, so a `dali:tabNavigated` message can be attributed
  // to the right tab by matching the message's source window.
  const iframeElsRef = useRef<Map<string, HTMLIFrameElement>>(new Map())
  // tabId → the URL we just asked the iframe to navigate to via back/forward.
  // When the resulting `dali:tabNavigated` arrives, we recognise it isn't a
  // "new" navigation and skip pushing to backStack / clearing forwardStack
  // (the goBack/goForward callers already updated the stacks themselves).
  const pendingHistoryOpRef = useRef<Map<string, string>>(new Map())
  // Stable ref callback PER tab id. The iframe's ref MUST keep the same
  // function identity across renders: an inline `ref={(el) => …}` is a new
  // function every render, so React detaches (ref(null)) and reattaches the
  // iframe node — and re-attaching an iframe reloads it from `src` (the mount
  // seed), snapping an in-iframe navigation back to the section root. Caching
  // one callback per id keeps the node attached so in-tab navigation sticks.
  const iframeRefCbs = useRef<Map<string, (el: HTMLIFrameElement | null) => void>>(new Map())
  const registerIframe = (tabId: string) => {
    let cb = iframeRefCbs.current.get(tabId)
    if (!cb) {
      cb = (el: HTMLIFrameElement | null) => {
        if (el) iframeElsRef.current.set(tabId, el)
        else iframeElsRef.current.delete(tabId)
      }
      iframeRefCbs.current.set(tabId, cb)
    }
    return cb
  }

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
        origin: t.url,
        // Stagger so the last seeded tab is the most recent (it's the active
        // one). The caller orders initial tabs from "anchor" (Home) to
        // "most specific" (the section the user actually navigated to), so
        // the last entry is what should be visible on first paint.
        lastActivatedAt: seedTime - (initialTabs.length - 1 - i),
        backStack: [],
        forwardStack: [],
        pinned: false,
        ephemeral: false,
      }))
      const paneId = loaded.panes[0]?.id ?? newId()
      setState({
        panes: [{ id: paneId, tabs, activeTabId: tabs[tabs.length - 1]?.id ?? null }],
        focusedPaneId: paneId,
        closedTabs: loaded.closedTabs,
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
          origin: target.url,
          lastActivatedAt: now(),
          backStack: [],
          forwardStack: [],
          pinned: false,
          ephemeral: false,
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

  // Track where each iframe navigates. Embedded pages post `dali:tabNavigated`
  // with their current location on every in-iframe route change; we attribute
  // it to a tab by matching the message's source window to that tab's iframe,
  // then update the tab's live `url` (for persistence + sidebar highlight).
  // The iframe's `src` is pinned to its mount seed, so this never reloads it.
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data
      if (!data || data.type !== 'dali:tabNavigated' || typeof data.url !== 'string') return
      let tabId: string | null = null
      for (const [id, el] of iframeElsRef.current) {
        if (el.contentWindow === e.source) {
          tabId = id
          break
        }
      }
      if (!tabId) return
      const nextUrl = data.url as string
      setState((prev) => {
        let changed = false
        const panes = prev.panes.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) => {
            if (t.id !== tabId || t.url === nextUrl) return t
            changed = true
            // Caused by our own back/forward — stacks were already adjusted
            // by goBack/goForward, so just sync url.
            const pending = pendingHistoryOpRef.current.get(t.id)
            if (pending === nextUrl) {
              pendingHistoryOpRef.current.delete(t.id)
              return { ...t, url: nextUrl }
            }
            // A new in-tab navigation: push the old url onto backStack and
            // clear forwardStack (browser semantics). Navigating inside a
            // preview tab is real engagement, so promote it to a kept tab.
            const back = [...t.backStack, t.url]
            if (back.length > HISTORY_CAP) back.splice(0, back.length - HISTORY_CAP)
            return { ...t, url: nextUrl, backStack: back, forwardStack: [], ephemeral: false }
          }),
        }))
        return changed ? { ...prev, panes } : prev
      })
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Whenever a tab becomes the active tab in any pane, ensure its iframe is
  // mounted. Tabs only mount when actually viewed; persisted-but-unvisited
  // tabs stay dormant until clicked.
  useEffect(() => {
    setMountedTabIds((prev) => {
      let next: Set<string> | null = null
      for (const pane of state.panes) {
        if (pane.activeTabId && !prev.has(pane.activeTabId)) {
          if (!next) next = new Set(prev)
          next.add(pane.activeTabId)
        }
      }
      return next ?? prev
    })
  }, [state])

  // Drop loaded-state for tabs that have been closed so the set stays bounded.
  useEffect(() => {
    const liveIds = new Set(state.panes.flatMap((p) => p.tabs.map((t) => t.id)))
    setLoadedTabIds((prev) => {
      let next: Set<string> | null = null
      for (const id of prev) {
        if (!liveIds.has(id)) {
          if (!next) next = new Set(prev)
          next.delete(id)
        }
      }
      return next ?? prev
    })
  }, [state])

  // Imperative API for the sidebar to open new tabs.
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      openTab: (req, opts) => {
        const ephemeral = opts?.ephemeral ?? false
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
          // Preview open: reuse the focused pane's existing ephemeral slot (if
          // any) by swapping in a fresh tab at the same position, so single-
          // clicking around the sidebar never stacks tabs. A new id gives the
          // iframe a clean seed without touching the cached src of other tabs.
          if (ephemeral) {
            const focused = prev.panes.find((p) => p.id === prev.focusedPaneId)
            const slotIdx = focused ? focused.tabs.findIndex((t) => t.ephemeral) : -1
            if (focused && slotIdx >= 0) {
              const replacement: Tab = {
                id: newId(),
                label: req.label,
                url: req.url,
                origin: req.url,
                lastActivatedAt: now(),
                backStack: [],
                forwardStack: [],
                pinned: false,
                ephemeral: true,
              }
              return {
                ...prev,
                panes: prev.panes.map((p) =>
                  p.id === focused.id
                    ? {
                        ...p,
                        activeTabId: replacement.id,
                        tabs: p.tabs.map((t, i) => (i === slotIdx ? replacement : t)),
                      }
                    : p,
                ),
              }
            }
          }
          const newTab: Tab = {
            id: newId(),
            label: req.label,
            url: req.url,
            origin: req.url,
            lastActivatedAt: now(),
            backStack: [],
            forwardStack: [],
            pinned: false,
            ephemeral,
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
      openTabInBackground: (req) => {
        setState((prev) => {
          // If already open, leave it alone — middle-clicking a sidebar item
          // for an open tab shouldn't yank the user away from what they're
          // viewing.
          if (findTabPane(prev, req.url)) return prev
          const newTab: Tab = {
            id: newId(),
            label: req.label,
            url: req.url,
            origin: req.url,
            lastActivatedAt: now() - 1, // older than the currently-active tab
            backStack: [],
            forwardStack: [],
            pinned: false,
            ephemeral: false,
          }
          return {
            ...prev,
            panes: prev.panes.map((p) =>
              p.id === prev.focusedPaneId
                ? {
                    ...p,
                    tabs: appendWithLruCap([...p.tabs, newTab], newTab.id),
                    // intentionally do NOT change activeTabId.
                  }
                : p,
            ),
          }
        })
      },
      openTabToSide: (req) => {
        setState((prev) => {
          // Already open somewhere — just focus it (don't duplicate).
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
            origin: req.url,
            lastActivatedAt: now(),
            backStack: [],
            forwardStack: [],
            pinned: false,
            ephemeral: false,
          }
          // Already split — open in the pane that isn't focused.
          if (prev.panes.length >= 2) {
            const sidePane =
              prev.panes.find((p) => p.id !== prev.focusedPaneId) ?? prev.panes[1]
            return {
              ...prev,
              focusedPaneId: sidePane.id,
              panes: prev.panes.map((p) =>
                p.id === sidePane.id
                  ? {
                      ...p,
                      tabs: appendWithLruCap([...p.tabs, newTab], newTab.id),
                      activeTabId: newTab.id,
                    }
                  : p,
              ),
            }
          }
          // Single pane — create a second one to the right.
          const newPaneId = newId()
          return {
            ...prev,
            focusedPaneId: newPaneId,
            panes: [...prev.panes, { id: newPaneId, tabs: [newTab], activeTabId: newTab.id }],
          }
        })
      },
      setTabLabel: (url, label) => {
        setState((prev) => {
          let changed = false
          const panes = prev.panes.map((p) => ({
            ...p,
            tabs: p.tabs.map((t) => {
              if ((t.url === url || t.origin === url) && t.label !== label) {
                changed = true
                return { ...t, label }
              }
              return t
            }),
          }))
          return changed ? { ...prev, panes } : prev
        })
      },
      broadcast: (message) => {
        for (const iframe of iframeElsRef.current.values()) {
          iframe.contentWindow?.postMessage(message, window.location.origin)
        }
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
    onMouseNav: (e: MouseEvent) => void
  } | null>(null)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // onShortcut is created once (below) and never re-created, so read the latest
  // palette callback through a ref rather than closing over the prop.
  const onOpenPaletteRef = useRef(onOpenPalette)
  onOpenPaletteRef.current = onOpenPalette

  if (!handlersRef.current) {
    handlersRef.current = {
      onShortcut: (e: KeyboardEvent) => {
        const mod = e.metaKey || e.ctrlKey

        const s = stateRef.current
        const focusedPane = s.panes.find((p) => p.id === s.focusedPaneId) ?? s.panes[0]
        if (!focusedPane) return

        // alt + arrow (no mod) — in-tab back/forward. Mirrors the browser
        // shortcut and intentionally NOT the same as mod+alt+arrow below,
        // which switches tabs in the focused pane.
        if (!mod && e.altKey && !e.shiftKey) {
          if (e.key === 'ArrowLeft') {
            e.preventDefault()
            goBack(focusedPane.id)
            return
          }
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            goForward(focusedPane.id)
            return
          }
          return
        }

        if (!mod) return

        // mod + k — open the command palette. (mod+shift+k closes a tab, below.)
        if (!e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault()
          onOpenPaletteRef.current?.()
          return
        }

        // mod + [ / mod + ] — in-tab back/forward.
        if (!e.altKey && !e.shiftKey && (e.key === '[' || e.key === ']')) {
          e.preventDefault()
          if (e.key === '[') goBack(focusedPane.id)
          else goForward(focusedPane.id)
          return
        }

        // mod + alt + arrow / number — pane navigation (next/prev tab).
        // Distinct from plain alt+arrow above (which is in-tab back/forward).
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

        // mod + shift + t — reopen most recently closed tab.
        if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
          e.preventDefault()
          reopenLastClosed()
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
      // Mouse thumb-buttons → in-tab back/forward. Preventing default also
      // suppresses the browser's own top-level history navigation, which
      // would otherwise unload the entire app shell.
      onMouseNav: (e: MouseEvent) => {
        if (e.button !== 3 && e.button !== 4) return
        const s = stateRef.current
        const focusedPane = s.panes.find((p) => p.id === s.focusedPaneId) ?? s.panes[0]
        if (!focusedPane) return
        e.preventDefault()
        if (e.button === 3) goBack(focusedPane.id)
        else goForward(focusedPane.id)
      },
    }
  }

  // Attach the shortcut listener to window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handlersRef.current?.onShortcut(e)
    const onMouse = (e: MouseEvent) => handlersRef.current?.onMouseNav(e)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    window.addEventListener('auxclick', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
      window.removeEventListener('auxclick', onMouse)
    }
  }, [])

  // Ref-callback for each iframe: attach the shortcut listener to its
  // contentDocument so shortcuts work when focus is inside the embedded page.
  // Re-runs on each iframe load (e.g., when the user navigates a link inside
  // the iframe), at which point contentDocument is a fresh Document object.
  const onIframeLoad = (tabId: string) => (e: React.SyntheticEvent<HTMLIFrameElement>) => {
    setLoadedTabIds((prev) => (prev.has(tabId) ? prev : new Set(prev).add(tabId)))
    const doc = e.currentTarget.contentDocument
    if (!doc) return
    const onKey = (ev: Event) => handlersRef.current?.onShortcut(ev as KeyboardEvent)
    const onMouse = (ev: Event) => handlersRef.current?.onMouseNav(ev as MouseEvent)
    // The previous document — if any — is gone with the previous navigation,
    // so its listener is gone with it. No need to remove first.
    doc.addEventListener('keydown', onKey)
    doc.addEventListener('mousedown', onMouse)
    doc.addEventListener('auxclick', onMouse)
    // Any genuine interaction inside a preview tab — a click/tap on a control, a
    // keystroke in a field — promotes it to a kept tab, so the next sidebar
    // single-click can't replace it and discard in-progress work. Passive
    // viewing (scroll, hover) deliberately does NOT promote. promoteTabById
    // no-ops once the tab is kept, so these stay cheap after the first hit.
    const onInteract = () => promoteTabById(tabId)
    doc.addEventListener('pointerdown', onInteract)
    doc.addEventListener('keydown', onInteract)
  }

  const dismissFloatingMenus = () => {
    setContextMenu(null)
    setHistoryMenu(null)
    setOverflowMenu(null)
  }
  const anyFloatingMenu = !!(contextMenu || historyMenu || overflowMenu)

  // Browser-style back/forward for the pane's active tab. The iframe's own
  // `window.history` would work mid-session but is wiped on a parent reload
  // (each tab's iframe re-mounts fresh), so we drive navigation via an
  // explicit per-tab stack + a `dali:navigate` postMessage that the embedded
  // layout turns into a react-router navigate().
  // Walk the active tab's back or forward stack `steps` entries. The
  // single-step case is the default (Back / Forward arrows). The history
  // dropdown uses larger N to jump directly to an earlier or later page —
  // the intervening URLs flip to the opposite stack so it stays equivalent
  // to clicking back/forward N times.
  const navigateActiveTab = (
    paneId: string,
    direction: 'back' | 'forward',
    steps = 1,
  ) => {
    const pane = stateRef.current.panes.find((p) => p.id === paneId)
    if (!pane) return
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId)
    if (!tab) return
    const source = direction === 'back' ? tab.backStack : tab.forwardStack
    if (steps < 1 || steps > source.length) return
    const consumed = source.slice(source.length - steps) // [oldest…newest in this jump]
    const target = consumed[0]
    pendingHistoryOpRef.current.set(tab.id, target)
    // Entries that pass to the opposite stack, in the order they'd be pushed
    // by N sequential single-step navigations: current url first, then each
    // consumed entry except the final target.
    const opposite: string[] = [tab.url]
    for (let k = consumed.length - 1; k >= 1; k--) opposite.push(consumed[k])
    setState((prev) => ({
      ...prev,
      panes: prev.panes.map((p) =>
        p.id !== paneId
          ? p
          : {
              ...p,
              tabs: p.tabs.map((t) => {
                if (t.id !== tab.id) return t
                if (direction === 'back') {
                  const fwd = [...t.forwardStack, ...opposite]
                  if (fwd.length > HISTORY_CAP) fwd.splice(0, fwd.length - HISTORY_CAP)
                  return {
                    ...t,
                    url: target,
                    backStack: t.backStack.slice(0, t.backStack.length - steps),
                    forwardStack: fwd,
                  }
                }
                const back = [...t.backStack, ...opposite]
                if (back.length > HISTORY_CAP) back.splice(0, back.length - HISTORY_CAP)
                return {
                  ...t,
                  url: target,
                  backStack: back,
                  forwardStack: t.forwardStack.slice(0, t.forwardStack.length - steps),
                }
              }),
            },
      ),
    }))
    const iframe = iframeElsRef.current.get(tab.id)
    iframe?.contentWindow?.postMessage(
      { type: 'dali:navigate', url: target },
      window.location.origin,
    )
  }
  const goBack = (paneId: string) => navigateActiveTab(paneId, 'back')
  const goForward = (paneId: string) => navigateActiveTab(paneId, 'forward')

  // Reopen the most recently closed tab in the focused pane, restoring its
  // url + history stacks. If the same tab was reopened already (any pane has
  // the same origin) we still pop and refocus the existing one rather than
  // duplicating — matches the browser's "reopen closed tab" feel.
  const reopenLastClosed = () => {
    setState((prev) => {
      if (prev.closedTabs.length === 0) return prev
      const last = prev.closedTabs[prev.closedTabs.length - 1]
      const closedTabs = prev.closedTabs.slice(0, -1)
      const existing = findTabPane(prev, last.origin)
      if (existing) {
        return {
          ...prev,
          focusedPaneId: existing.paneId,
          panes: prev.panes.map((p) =>
            p.id !== existing.paneId
              ? p
              : {
                  ...p,
                  activeTabId: existing.tabId,
                  tabs: p.tabs.map((t) =>
                    t.id === existing.tabId ? { ...t, lastActivatedAt: now() } : t,
                  ),
                },
          ),
          closedTabs,
        }
      }
      const newTab: Tab = {
        id: newId(),
        label: last.label,
        url: last.url,
        origin: last.origin,
        lastActivatedAt: now(),
        backStack: last.backStack,
        forwardStack: last.forwardStack,
        pinned: false,
        ephemeral: false,
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
        closedTabs,
      }
    })
  }

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
      const closing = prev.panes.find((p) => p.id === paneId)?.tabs.find((t) => t.id === tabId)
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
      // Push to recently-closed LRU so the user can reopen with mod+shift+T.
      const closedTabs = closing
        ? [
            ...prev.closedTabs,
            {
              label: closing.label,
              url: closing.url,
              origin: closing.origin,
              backStack: closing.backStack,
              forwardStack: closing.forwardStack,
              closedAt: now(),
            },
          ].slice(-CLOSED_CAP)
        : prev.closedTabs
      // If a pane became empty AND there's another pane, remove it.
      const nonEmpty = panes.filter((p) => p.tabs.length > 0)
      if (nonEmpty.length > 0 && nonEmpty.length < panes.length) {
        const focusedStillExists = nonEmpty.some((p) => p.id === prev.focusedPaneId)
        return {
          panes: nonEmpty,
          focusedPaneId: focusedStillExists ? prev.focusedPaneId : nonEmpty[0].id,
          closedTabs,
        }
      }
      return { ...prev, panes, closedTabs }
    })
  }

  // Close a set of tabs in one pane at once (backs the bulk-close context-menu
  // actions). Mirrors closeTab's bookkeeping: records each closed tab in the
  // recently-closed LRU, repoints activeTabId to the nearest survivor, and drops
  // a pane that empties. Pinned tabs are filtered out by the callers.
  const closeTabs = (paneId: string, idsToClose: Set<string>) => {
    if (idsToClose.size === 0) return
    setState((prev) => {
      const pane = prev.panes.find((p) => p.id === paneId)
      if (!pane) return prev
      const closing = pane.tabs.filter((t) => idsToClose.has(t.id))
      if (closing.length === 0) return prev
      const remaining = pane.tabs.filter((t) => !idsToClose.has(t.id))
      let activeTabId = pane.activeTabId
      if (activeTabId && idsToClose.has(activeTabId)) {
        // Walk outward from the old active index for the nearest surviving tab.
        const oldIdx = pane.tabs.findIndex((t) => t.id === activeTabId)
        let pick: string | null = null
        for (let d = 1; d < pane.tabs.length && !pick; d++) {
          const after = pane.tabs[oldIdx + d]
          if (after && !idsToClose.has(after.id)) pick = after.id
          const before = pane.tabs[oldIdx - d]
          if (!pick && before && !idsToClose.has(before.id)) pick = before.id
        }
        activeTabId = pick ?? remaining[0]?.id ?? null
      }
      const closedTabs = [
        ...prev.closedTabs,
        ...closing.map((t) => ({
          label: t.label,
          url: t.url,
          origin: t.origin,
          backStack: t.backStack,
          forwardStack: t.forwardStack,
          closedAt: now(),
        })),
      ].slice(-CLOSED_CAP)
      const panes = prev.panes.map((p) =>
        p.id === paneId ? { ...p, tabs: remaining, activeTabId } : p,
      )
      const nonEmpty = panes.filter((p) => p.tabs.length > 0)
      if (nonEmpty.length > 0 && nonEmpty.length < panes.length) {
        const focusedStillExists = nonEmpty.some((p) => p.id === prev.focusedPaneId)
        return {
          panes: nonEmpty,
          focusedPaneId: focusedStillExists ? prev.focusedPaneId : nonEmpty[0].id,
          closedTabs,
        }
      }
      return { ...prev, panes, closedTabs }
    })
  }

  // Promote a preview (ephemeral) tab to a kept tab. Triggered by double-click;
  // in-tab navigation and pinning promote via their own paths.
  const promoteTab = (paneId: string, tabId: string) => {
    setState((prev) => ({
      ...prev,
      panes: prev.panes.map((p) =>
        p.id !== paneId
          ? p
          : {
              ...p,
              tabs: p.tabs.map((t) =>
                t.id === tabId && t.ephemeral ? { ...t, ephemeral: false } : t,
              ),
            },
      ),
    }))
  }

  // Promote a preview tab to kept by id, without needing its pane. Used by the
  // in-iframe interaction listeners. Returns the previous state unchanged when
  // the tab isn't ephemeral, so the common case (interacting with an already-
  // kept tab) bails out of setState and never re-renders.
  const promoteTabById = (tabId: string) => {
    setState((prev) => {
      let changed = false
      const panes = prev.panes.map((p) => {
        if (!p.tabs.some((t) => t.id === tabId && t.ephemeral)) return p
        changed = true
        return {
          ...p,
          tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, ephemeral: false } : t)),
        }
      })
      return changed ? { ...prev, panes } : prev
    })
  }

  // Toggle pinned state. Pinning also promotes a preview tab (a pin is a
  // commitment), and re-normalizes so pinned tabs cluster at the pane's left.
  const togglePin = (paneId: string, tabId: string) => {
    setState((prev) => ({
      ...prev,
      panes: prev.panes.map((p) => {
        if (p.id !== paneId) return p
        const tabs = p.tabs.map((t) =>
          t.id === tabId ? { ...t, pinned: !t.pinned, ephemeral: false } : t,
        )
        return { ...p, tabs: normalize(tabs) }
      }),
    }))
  }

  // Duplicate a tab in place: a new tab opens immediately after the source in
  // the same pane, pointing at the source's current url. We don't copy the
  // source's history stacks — the duplicate is conceptually a fresh visit to
  // the same page (matches Chrome's "Duplicate" behaviour) and starts with
  // empty back/forward.
  const duplicateTab = (paneId: string, tabId: string) => {
    setState((prev) => {
      const pane = prev.panes.find((p) => p.id === paneId)
      const source = pane?.tabs.find((t) => t.id === tabId)
      if (!pane || !source) return prev
      const newTab: Tab = {
        id: newId(),
        label: source.label,
        url: source.url,
        origin: source.url,
        lastActivatedAt: now(),
        backStack: [],
        forwardStack: [],
        pinned: false,
        ephemeral: false,
      }
      const idx = pane.tabs.findIndex((t) => t.id === tabId)
      const inserted = [
        ...pane.tabs.slice(0, idx + 1),
        newTab,
        ...pane.tabs.slice(idx + 1),
      ]
      return {
        ...prev,
        focusedPaneId: paneId,
        panes: prev.panes.map((p) =>
          p.id !== paneId
            ? p
            : {
                ...p,
                tabs: appendWithLruCap(inserted, newTab.id),
                activeTabId: newTab.id,
              },
        ),
      }
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
        closedTabs: prev.closedTabs,
      }
    })
  }

  const closePane = (paneId: string) => {
    setState((prev) => {
      if (prev.panes.length === 1) return prev
      const closing = prev.panes.find((p) => p.id === paneId)
      const panes = prev.panes.filter((p) => p.id !== paneId)
      const recorded = closing
        ? closing.tabs.map((t) => ({
            label: t.label,
            url: t.url,
            origin: t.origin,
            backStack: t.backStack,
            forwardStack: t.forwardStack,
            closedAt: now(),
          }))
        : []
      const closedTabs = [...prev.closedTabs, ...recorded].slice(-CLOSED_CAP)
      return {
        panes,
        focusedPaneId: panes[0].id,
        closedTabs,
      }
    })
  }

  // Full screen a tab: collapse the split back to a single pane so the given
  // tab fills the workspace. The other pane's tabs are NOT discarded — they're
  // merged into the surviving pane's tab strip (LRU-capped), so the tab list is
  // untouched; only the split layout goes away. The chosen tab becomes active.
  // No-op with one pane (already full width).
  const fullScreenTab = (paneId: string, tabId: string) => {
    setState((prev) => {
      if (prev.panes.length < 2) return prev
      const target = prev.panes.find((p) => p.id === paneId)
      if (!target) return prev
      // The target pane's tabs first (so the chosen one and its siblings keep
      // their order), then the other panes' tabs appended after.
      const others = prev.panes.filter((p) => p.id !== paneId).flatMap((p) => p.tabs)
      const merged = appendWithLruCap([...target.tabs, ...others], tabId)
      return {
        panes: [{ id: paneId, tabs: merged, activeTabId: tabId }],
        focusedPaneId: paneId,
        closedTabs: prev.closedTabs,
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
            p.id === source.paneId ? { ...p, tabs: normalize(next), activeTabId: tab.id } : p,
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
            tabs: appendWithLruCap(normalize(inserted), tab.id),
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
        closedTabs: prev.closedTabs,
      }
    })
  }

  // Pull a tab out of its (single) pane into a brand-new pane on the chosen
  // side, forming a split. No-op unless there's exactly one pane with at
  // least two tabs — moving the source pane's only tab would just empty it
  // and leave a single view. Once two panes exist (the current max), a body
  // drop is handled as a plain cross-pane move instead.
  const dropToSplit = (source: DragSource, side: 'left' | 'right') => {
    setState((prev) => {
      if (prev.panes.length !== 1) return prev
      const sourcePane = prev.panes.find((p) => p.id === source.paneId)
      if (!sourcePane || sourcePane.tabs.length < 2) return prev
      const sourceTab = sourcePane.tabs.find((t) => t.id === source.tabId)
      if (!sourceTab) return prev

      const tab: Tab = { ...sourceTab, lastActivatedAt: now() }
      const remaining = sourcePane.tabs.filter((t) => t.id !== source.tabId)
      const newPaneId = newId()
      const updatedSource: Pane = {
        ...sourcePane,
        tabs: remaining,
        activeTabId:
          sourcePane.activeTabId === source.tabId
            ? (remaining[0]?.id ?? null)
            : sourcePane.activeTabId,
      }
      const newPane: Pane = { id: newPaneId, tabs: [tab], activeTabId: tab.id }
      return {
        focusedPaneId: newPaneId,
        panes: side === 'left' ? [newPane, updatedSource] : [updatedSource, newPane],
        closedTabs: prev.closedTabs,
      }
    })
  }

  return (
    <div className="flex-1 flex min-h-0">
      {state.panes.map((pane, idx) => {
        const isFocused = pane.id === state.focusedPaneId
        const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId) ?? pane.tabs[0]
        const showLeftBorder = idx > 0
        const { pinned: pinnedTabs, visible: visibleUnpinned, overflow: overflowUnpinned } =
          splitVisibleOverflow(pane.tabs, paneWidths[pane.id] ?? 0)

        // Render one tab button. Pinned tabs are compact (pin icon + short label,
        // no close affordance — middle-click or the context menu unpins/closes);
        // unpinned tabs keep the hover × . Ephemeral (preview) tabs render italic.
        const renderTab = (tab: Tab) => {
          const arrIdx = pane.tabs.findIndex((t) => t.id === tab.id)
          const isActive = tab.id === pane.activeTabId
          const indicatorBefore = dragOver?.paneId === pane.id && dragOver.index === arrIdx
          const indicatorAfter =
            dragOver?.paneId === pane.id &&
            dragOver.index === arrIdx + 1 &&
            arrIdx === pane.tabs.length - 1
          return (
            <button
              key={tab.id}
              type="button"
              draggable
              onDragStart={(e) => {
                dragSourceRef.current = { paneId: pane.id, tabId: tab.id }
                setIsDragging(true)
                e.dataTransfer.effectAllowed = 'move'
                try {
                  e.dataTransfer.setData('text/plain', tab.id)
                } catch {
                  // ignore
                }
              }}
              onDragEnd={() => {
                dragSourceRef.current = null
                setDragOver(null)
                setPaneDrop(null)
                setIsDragging(false)
              }}
              onDragOver={(e) => {
                if (!dragSourceRef.current) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                if (paneDrop) setPaneDrop(null)
                const rect = e.currentTarget.getBoundingClientRect()
                const midpoint = rect.left + rect.width / 2
                const insertIdx = e.clientX < midpoint ? arrIdx : arrIdx + 1
                if (dragOver?.paneId !== pane.id || dragOver.index !== insertIdx) {
                  setDragOver({ paneId: pane.id, index: insertIdx })
                }
              }}
              onDrop={(e) => {
                if (!dragSourceRef.current) return
                e.preventDefault()
                e.stopPropagation()
                const src = dragSourceRef.current
                const tgt = dragOver ?? { paneId: pane.id, index: arrIdx }
                moveTab(src, tgt)
                dragSourceRef.current = null
                setDragOver(null)
                setPaneDrop(null)
                setIsDragging(false)
              }}
              onClick={(e) => {
                e.stopPropagation()
                dismissFloatingMenus()
                setActiveTab(pane.id, tab.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                promoteTab(pane.id, tab.id)
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                e.stopPropagation()
                dismissFloatingMenus()
                closeTab(pane.id, tab.id)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // Toggle closed when right-clicking the same tab again — the
                // open handler's stopPropagation would otherwise leave the
                // menu stuck (window never sees the event to dismiss it).
                setContextMenu((prev) =>
                  prev?.paneId === pane.id && prev.tabId === tab.id
                    ? null
                    : { paneId: pane.id, tabId: tab.id, x: e.clientX, y: e.clientY },
                )
                setHistoryMenu(null)
                setOverflowMenu(null)
              }}
              title={tab.label}
              style={{ width: tab.pinned ? PINNED_TAB_W : TAB_W }}
              className={`group relative flex-none flex items-center gap-2 ${tab.pinned ? 'px-2.5' : 'px-3'} border-r border-border text-xs font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-card text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-card/50'
              } ${indicatorBefore ? 'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent-coral' : ''} ${indicatorAfter ? 'after:absolute after:right-0 after:top-0 after:bottom-0 after:w-0.5 after:bg-accent-coral' : ''}`}
            >
              {tab.pinned && (
                <Pin className="w-3 h-3 shrink-0 text-accent-coral fill-accent-coral pointer-events-none" />
              )}
              <span
                className={`truncate flex-1 text-left pointer-events-none ${tab.ephemeral ? 'italic' : ''}`}
              >
                {tab.label}
              </span>
              {!tab.pinned && (
                <span
                  role="button"
                  aria-label={`Close ${tab.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    dismissFloatingMenus()
                    closeTab(pane.id, tab.id)
                  }}
                  className="p-0.5 rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-muted opacity-60 group-hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </span>
              )}
            </button>
          )
        }
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
              <div className="flex items-stretch border-r border-border">
                {(() => {
                  const canBack = !!activeTab && activeTab.backStack.length > 0
                  const canFwd = !!activeTab && activeTab.forwardStack.length > 0
                  const navBtn = (enabled: boolean) =>
                    `px-2.5 ${
                      enabled
                        ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        : 'text-muted-foreground/30 cursor-default'
                    }`
                  return (
                    <>
                      <button
                        type="button"
                        disabled={!canBack}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!canBack) return
                          goBack(pane.id)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (!canBack) return
                          setHistoryMenu((prev) =>
                            prev?.paneId === pane.id && prev.side === 'back'
                              ? null
                              : { paneId: pane.id, side: 'back', x: e.clientX, y: e.clientY },
                          )
                          setContextMenu(null)
                          setOverflowMenu(null)
                        }}
                        title={canBack ? 'Back (right-click for history)' : 'Back'}
                        aria-label="Back"
                        className={navBtn(canBack)}
                      >
                        <ChevronLeft className="w-[18px] h-[18px]" />
                      </button>
                      <button
                        type="button"
                        disabled={!canFwd}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!canFwd) return
                          goForward(pane.id)
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (!canFwd) return
                          setHistoryMenu((prev) =>
                            prev?.paneId === pane.id && prev.side === 'forward'
                              ? null
                              : { paneId: pane.id, side: 'forward', x: e.clientX, y: e.clientY },
                          )
                          setContextMenu(null)
                          setOverflowMenu(null)
                        }}
                        title={canFwd ? 'Forward (right-click for history)' : 'Forward'}
                        aria-label="Forward"
                        className={navBtn(canFwd)}
                      >
                        <ChevronRight className="w-[18px] h-[18px]" />
                      </button>
                    </>
                  )
                })()}
              </div>
              <div
                ref={stripRefCb(pane.id)}
                className="flex flex-1 min-w-0 items-stretch"
              >
                <div
                  className="flex-1 min-w-0 flex items-stretch overflow-x-auto"
                  onDragOver={(e) => {
                    // Allow drop on the empty area at the end of the strip.
                    if (dragSourceRef.current) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      if (paneDrop) setPaneDrop(null)
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
                    setPaneDrop(null)
                    setIsDragging(false)
                  }}
                >
                  {pinnedTabs.map(renderTab)}
                  {visibleUnpinned.map(renderTab)}
                  {pane.tabs.length === 0 && (
                    <div className="px-3 flex items-center text-xs text-muted-foreground/60">
                      No tabs open. Click a section in the sidebar.
                    </div>
                  )}
                </div>
                {overflowUnpinned.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      // Toggle: stopPropagation blocks the shell dismiss
                      // listener, so a second click on +N must close itself.
                      if (overflowMenu?.paneId === pane.id) {
                        setOverflowMenu(null)
                        return
                      }
                      const rect = e.currentTarget.getBoundingClientRect()
                      setOverflowMenu({ paneId: pane.id, x: rect.right, y: rect.bottom })
                      setContextMenu(null)
                      setHistoryMenu(null)
                    }}
                    title={`${overflowUnpinned.length} more tab${overflowUnpinned.length === 1 ? '' : 's'}`}
                    aria-label={`Show ${overflowUnpinned.length} more tabs`}
                    style={{ width: OVERFLOW_BTN_W }}
                    className="flex-none flex items-center justify-center gap-0.5 border-l border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors"
                  >
                    +{overflowUnpinned.length}
                    <ChevronDown className="w-3 h-3" />
                  </button>
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

            {/* One iframe per opened tab; non-active tabs hidden via
                display:none so switching preserves scroll/form/JS state
                instead of reloading. */}
            <div className="flex-1 min-h-0 bg-section-bg relative">
              {pane.tabs.map((tab) => {
                if (!mountedTabIds.has(tab.id)) return null
                const isActive = tab.id === pane.activeTabId
                return (
                  <iframe
                    key={tab.id}
                    ref={registerIframe(tab.id)}
                    src={addEmbedParam(seedFor(tab))}
                    title={titleFor(tab)}
                    className="absolute inset-0 w-full h-full border-0"
                    style={{ display: isActive ? 'block' : 'none' }}
                    onLoad={onIframeLoad(tab.id)}
                  />
                )
              })}
              {/* Spinner over the active tab while its iframe document is
                  still doing its initial load (before onLoad fires). */}
              {activeTab && mountedTabIds.has(activeTab.id) && !loadedTabIds.has(activeTab.id) && (
                <div className="absolute inset-0 flex items-center justify-center bg-section-bg">
                  <Loader2 className="w-6 h-6 text-accent-teal animate-spin motion-reduce:animate-none" />
                </div>
              )}
              {!activeTab && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/60 text-sm">
                  No content
                </div>
              )}

              {/* Drop-catcher sits above the iframe while a tab is being
                  dragged. iframes eat native drag events, so the pane body
                  can only receive dragover/drop through this overlay. */}
              {isDragging && (
                <div
                  className="absolute inset-0 z-10"
                  onDragOver={(e) => {
                    if (!dragSourceRef.current) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (dragOver) setDragOver(null)
                    let zone: PaneDropZone = 'center'
                    // Split zones are only meaningful for a lone pane with at
                    // least two tabs. Once split (two panes — the max), every
                    // body drop is just a move into the hovered pane.
                    if (state.panes.length === 1 && pane.tabs.length >= 2) {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const x = e.clientX - rect.left
                      const band = rect.width / 3
                      if (x < band) zone = 'split-left'
                      else if (x > rect.width - band) zone = 'split-right'
                    }
                    if (paneDrop?.paneId !== pane.id || paneDrop.zone !== zone) {
                      setPaneDrop({ paneId: pane.id, zone })
                    }
                  }}
                  onDrop={(e) => {
                    if (!dragSourceRef.current) return
                    e.preventDefault()
                    const src = dragSourceRef.current
                    const zone = paneDrop?.paneId === pane.id ? paneDrop.zone : 'center'
                    if (zone === 'split-left') dropToSplit(src, 'left')
                    else if (zone === 'split-right') dropToSplit(src, 'right')
                    else moveTab(src, { paneId: pane.id, index: pane.tabs.length })
                    dragSourceRef.current = null
                    setDragOver(null)
                    setPaneDrop(null)
                    setIsDragging(false)
                  }}
                >
                  {paneDrop?.paneId === pane.id && (
                    <div
                      className={`absolute inset-y-0 bg-accent-coral/20 border-2 border-accent-coral pointer-events-none ${
                        paneDrop.zone === 'split-left'
                          ? 'left-0 w-1/2'
                          : paneDrop.zone === 'split-right'
                            ? 'right-0 w-1/2'
                            : 'inset-x-0'
                      }`}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Invisible backdrop so a click anywhere — including over an iframe —
          dismisses floating tab menus. Menus sit above it at z-50. */}
      {anyFloatingMenu && (
        <div
          className="fixed inset-0 z-40"
          aria-hidden
          onMouseDown={dismissFloatingMenus}
          onContextMenu={(e) => {
            e.preventDefault()
            dismissFloatingMenus()
          }}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (() => {
        const cmPane = state.panes.find((p) => p.id === contextMenu.paneId)
        const cmTab = cmPane?.tabs.find((t) => t.id === contextMenu.tabId)
        if (!cmPane || !cmTab) return null
        const cmIdx = cmPane.tabs.findIndex((t) => t.id === contextMenu.tabId)
        // Bulk-close sets always spare pinned tabs.
        const otherIds = cmPane.tabs.filter((t) => t.id !== cmTab.id && !t.pinned).map((t) => t.id)
        const rightIds = cmPane.tabs.slice(cmIdx + 1).filter((t) => !t.pinned).map((t) => t.id)
        const unpinnedIds = cmPane.tabs.filter((t) => !t.pinned).map((t) => t.id)
        const hasPinned = cmPane.tabs.some((t) => t.pinned)
        const item = 'w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-left'
        return (
        <div
          data-floating-menu
          className="fixed z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[200px] text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              togglePin(contextMenu.paneId, contextMenu.tabId)
              setContextMenu(null)
            }}
            className={item}
          >
            {cmTab.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            {cmTab.pinned ? 'Unpin tab' : 'Pin tab'}
          </button>
          {state.panes.length >= 2 ? (
            <button
              type="button"
              onClick={() => {
                fullScreenTab(contextMenu.paneId, contextMenu.tabId)
                setContextMenu(null)
              }}
              className={item}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Full screen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                openTabToSide(contextMenu.paneId, contextMenu.tabId)
                setContextMenu(null)
              }}
              className={item}
            >
              <SplitSquareHorizontal className="w-3.5 h-3.5" />
              Open to the side
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              duplicateTab(contextMenu.paneId, contextMenu.tabId)
              setContextMenu(null)
            }}
            className={item}
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate tab
          </button>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => {
              closeTab(contextMenu.paneId, contextMenu.tabId)
              setContextMenu(null)
            }}
            className={`${item} text-foreground`}
          >
            <X className="w-3.5 h-3.5" />
            Close tab
          </button>
          {otherIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                closeTabs(contextMenu.paneId, new Set(otherIds))
                setContextMenu(null)
              }}
              className={item}
            >
              <X className="w-3.5 h-3.5" />
              Close others
            </button>
          )}
          {rightIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                closeTabs(contextMenu.paneId, new Set(rightIds))
                setContextMenu(null)
              }}
              className={item}
            >
              <X className="w-3.5 h-3.5" />
              Close tabs to the right
            </button>
          )}
          {hasPinned && unpinnedIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                closeTabs(contextMenu.paneId, new Set(unpinnedIds))
                setContextMenu(null)
              }}
              className={item}
            >
              <X className="w-3.5 h-3.5" />
              Close unpinned
            </button>
          )}
        </div>
        )
      })()}

      {/* Back/forward history dropdown. Entries are listed most-recent first;
          clicking entry i navigates i+1 steps in that direction. */}
      {historyMenu && (() => {
        const pane = state.panes.find((p) => p.id === historyMenu.paneId)
        const tab = pane?.tabs.find((t) => t.id === pane.activeTabId)
        const stack = tab
          ? historyMenu.side === 'back' ? tab.backStack : tab.forwardStack
          : []
        if (stack.length === 0) return null
        // Display newest first so the first list item == one click on the
        // arrow. Slice to keep the dropdown bounded; 15 is plenty for casual
        // recall and avoids running off the screen on small displays.
        const entries = stack.slice(-15).reverse()
        return (
          <div
            data-floating-menu
            className="fixed z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[260px] max-w-[440px] text-xs"
            style={{ left: historyMenu.x, top: historyMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {entries.map((url, displayIdx) => {
              const steps = displayIdx + 1
              return (
                <button
                  key={`${steps}-${url}`}
                  type="button"
                  onClick={() => {
                    navigateActiveTab(historyMenu.paneId, historyMenu.side, steps)
                    setHistoryMenu(null)
                  }}
                  title={url}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-left text-foreground"
                >
                  <span className="truncate">{url}</span>
                </button>
              )
            })}
          </div>
        )
      })()}

      {/* Overflow dropdown: the unpinned tabs that didn't fit inline. Clicking
          one activates it (which bumps it back into the visible set); the ×
          closes it. Right-aligned under the +N button via a translate. */}
      {overflowMenu && (() => {
        const pane = state.panes.find((p) => p.id === overflowMenu.paneId)
        if (!pane) return null
        const { overflow } = splitVisibleOverflow(pane.tabs, paneWidths[pane.id] ?? 0)
        if (overflow.length === 0) return null
        const ordered = [...overflow].sort((a, b) => b.lastActivatedAt - a.lastActivatedAt)
        return (
          <div
            data-floating-menu
            className="fixed z-50 bg-card border border-border rounded-md shadow-lg py-1 min-w-[200px] max-w-[320px] text-sm -translate-x-full"
            style={{ left: overflowMenu.x, top: overflowMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {ordered.map((tab) => (
              <div
                key={tab.id}
                className="group flex items-center gap-2 pl-3 pr-1.5 py-1.5 hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab(overflowMenu.paneId, tab.id)
                    setOverflowMenu(null)
                  }}
                  title={tab.label}
                  className="flex-1 min-w-0 flex items-center text-left"
                >
                  <span className={`truncate ${tab.ephemeral ? 'italic' : ''}`}>{tab.label}</span>
                </button>
                <span
                  role="button"
                  aria-label={`Close ${tab.label}`}
                  onClick={() => closeTab(overflowMenu.paneId, tab.id)}
                  className="p-0.5 rounded-sm text-muted-foreground/60 hover:text-foreground hover:bg-card opacity-60 group-hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </span>
              </div>
            ))}
          </div>
        )
      })()}
    </div>
  )
}

function addEmbedParam(url: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}embed=1`
}
