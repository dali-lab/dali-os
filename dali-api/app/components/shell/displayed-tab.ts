import { useSyncExternalStore, type ContextType } from 'react'
import { UNSAFE_DataRouterStateContext, UNSAFE_LocationContext, UNSAFE_RouteContext } from 'react-router'

export type DisplayedTab = {
  id: string
  label: string
  data: ContextType<typeof UNSAFE_DataRouterStateContext>
  location: ContextType<typeof UNSAFE_LocationContext>
  route: ContextType<typeof UNSAFE_RouteContext>
}

let current: DisplayedTab | null = null
const listeners = new Set<() => void>()

/** The kept tab on screen while the router has not yet committed its location. */
export function publishDisplayedTab(next: DisplayedTab | null) {
  if (
    current === next ||
    (current && next && current.id === next.id && current.label === next.label &&
      current.data === next.data && current.location === next.location && current.route === next.route)
  ) {
    return
  }
  current = next
  for (const l of listeners) l()
}

export function useDisplayedTab(): DisplayedTab | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => current,
    () => null,
  )
}
