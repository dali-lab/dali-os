import {
  Activity,
  createContext,
  memo,
  useContext,
  useLayoutEffect,
  useRef,
  type ContextType,
  type ReactNode,
} from 'react'
import { UNSAFE_DataRouterStateContext, UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation } from 'react-router'
import { PageBarVisibility } from '~/components/shell/page-bar-slot'
import { sameUrl } from '~/lib/desktop-tabs'
import { getTabsSnapshot } from '~/lib/desktop-tabs-store'
import { useDesktopTabsState } from '~/components/DesktopTabs'

const BOOT_SLOT = 'boot'

const TabsShowingContext = createContext(false)
export const TabsShowingProvider = TabsShowingContext.Provider

type Snapshot = {
  data: ContextType<typeof UNSAFE_DataRouterStateContext>
  location: ContextType<typeof UNSAFE_LocationContext>
  route: ContextType<typeof UNSAFE_RouteContext>
  page: ReactNode
}

/**
 * Keeps every open tab's page mounted but hidden, so switching
 * back skips the loader wait and the remount. A page stays frozen on the router
 * state it last rendered with until the router is back on its url.
 */
export function TabKeepAlive({ children }: { children: ReactNode }) {
  const showing = useContext(TabsShowingContext)
  return showing ? <KeepAliveHost>{children}</KeepAliveHost> : <>{children}</>
}

const Slot = memo(function Slot({
  snapshot,
  visible,
}: {
  snapshot: Snapshot
  visible: boolean
}) {
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <UNSAFE_DataRouterStateContext.Provider value={snapshot.data}>
        <UNSAFE_LocationContext.Provider value={snapshot.location}>
          <UNSAFE_RouteContext.Provider value={snapshot.route}>
            <PageBarVisibility hidden={!visible}>{snapshot.page}</PageBarVisibility>
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </UNSAFE_DataRouterStateContext.Provider>
    </Activity>
  )
})

function KeepAliveHost({ children }: { children: ReactNode }) {
  const { tabs, activeId } = useDesktopTabsState()
  const location = useLocation()
  const data = useContext(UNSAFE_DataRouterStateContext)
  const locationContext = useContext(UNSAFE_LocationContext)
  const route = useContext(UNSAFE_RouteContext)

  const routerUrl = location.pathname + location.search
  const snapshots = useRef(new Map<string, Snapshot>())
  const reactKeys = useRef(new Map<string, string>())
  const liveId = useRef<string | null>(null)
  const liveKey = useRef<string | null>(null)

  // A new router location always belongs to the active tab, even when it
  // redirected away from the url the tab asked for.
  const displayed = tabs.find((t) => t.id === activeId) ?? null
  if (location.key !== liveKey.current || (displayed && sameUrl(displayed.url, routerUrl))) {
    liveKey.current = location.key
    liveId.current = displayed?.id ?? liveId.current ?? BOOT_SLOT
  }
  const live = liveId.current ?? BOOT_SLOT

  const booted = snapshots.current.get(BOOT_SLOT)
  if (booted && live !== BOOT_SLOT) {
    snapshots.current.delete(BOOT_SLOT)
    reactKeys.current.set(live, BOOT_SLOT)
  }
  snapshots.current.set(live, { data, location: locationContext, route, page: children })

  const open = new Set(tabs.map((t) => t.id))
  for (const id of [...snapshots.current.keys()]) {
    if (id === live) continue
    if (!open.has(id)) {
      snapshots.current.delete(id)
      reactKeys.current.delete(id)
    }
  }

  const showId = displayed && snapshots.current.has(displayed.id) ? displayed.id : live

  const lastShown = useRef(showId)
  useLayoutEffect(() => {
    if (lastShown.current === showId) return
    lastShown.current = showId
    const tab = getTabsSnapshot().tabs.find((t) => t.id === showId)
    if (tab) window.scrollTo(0, tab.scrollY)
  }, [showId])

  return (
    <>
      {[...snapshots.current].map(([id, snapshot]) => (
        <Slot key={reactKeys.current.get(id) ?? id} snapshot={snapshot} visible={id === showId} />
      ))}
    </>
  )
}
