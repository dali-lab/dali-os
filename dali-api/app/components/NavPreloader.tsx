import { useEffect, useMemo, useState } from 'react'
import { PrefetchPageLinks } from 'react-router'
import type { FavoritePage } from '~/lib/user-pages.server'

/** How many sidebar destinations to warm. Favorites first, then recents. */
const PRELOAD_LIMIT = 6
/** Gap between successive warms, so six loaders don't hit the server at once. */
const STAGGER_MS = 500
/** Idle deadline — warm anyway on a shell that never goes fully idle. */
const IDLE_TIMEOUT_MS = 3000
/** Delay used where requestIdleCallback is missing (older WebKit). */
const IDLE_FALLBACK_MS = 1500

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

/**
 * The hrefs to warm, in priority order: pinned pages first, then recents,
 * de-duplicated. Only in-app paths — a route favorite could hold anything the
 * star button captured, and prefetching an off-site URL is neither useful nor
 * ours to do.
 */
export function preloadTargets(
  favorites: FavoritePage[],
  recents: FavoritePage[],
  limit = PRELOAD_LIMIT,
): string[] {
  const seen = new Set<string>()
  const targets: string[] = []
  for (const page of [...favorites, ...recents]) {
    const href = page.href
    if (!href.startsWith('/') || href.startsWith('//')) continue
    if (seen.has(href)) continue
    seen.add(href)
    targets.push(href)
    if (targets.length >= limit) break
  }
  return targets
}

/** Don't spend someone's metered or 2g connection warming pages they may never open. */
function preloadAllowed(): boolean {
  if (typeof navigator === 'undefined') return false
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection
  if (!conn) return true
  if (conn.saveData) return false
  return !(conn.effectiveType ?? '').includes('2g')
}

function whenIdle(fn: () => void): () => void {
  const win = window as IdleWindow
  if (typeof win.requestIdleCallback === 'function') {
    const id = win.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS })
    return () => win.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, IDLE_FALLBACK_MS)
  return () => window.clearTimeout(id)
}

/**
 * Warms the sidebar's Favorites and Recent destinations once the shell is idle,
 * so opening one from the navbar renders from cache instead of a cold fetch.
 * Each target renders React Router's <PrefetchPageLinks>, which preloads that
 * route's modules and (in tabless mode) its loader data; in tab mode the module
 * preloads still land, since every workspace iframe shares this document's cache.
 *
 * Prefetched loaders MUST NOT treat the hit as a page open — see
 * isPrefetchRequest and the recordRouteVisit/recordPageVisit guards, without
 * which warming the Recent list would rewrite the very order it warmed from.
 */
export function NavPreloader({
  favorites,
  recents,
}: {
  favorites: FavoritePage[]
  recents: FavoritePage[]
}) {
  const targets = useMemo(() => preloadTargets(favorites, recents), [favorites, recents])
  // How many of `targets` are live. Grows one per tick; starts at 0 so the
  // server render and first paint carry no prefetch links at all.
  const [warmed, setWarmed] = useState(0)

  useEffect(() => {
    if (targets.length === 0 || !preloadAllowed()) return
    let cancelled = false
    let interval = 0
    const cancelIdle = whenIdle(() => {
      if (cancelled) return
      let n = 1
      setWarmed(n)
      interval = window.setInterval(() => {
        n += 1
        setWarmed(n)
        if (n >= targets.length) window.clearInterval(interval)
      }, STAGGER_MS)
    })
    return () => {
      cancelled = true
      cancelIdle()
      window.clearInterval(interval)
    }
  }, [targets])

  return (
    <>
      {targets.slice(0, warmed).map((href) => (
        <PrefetchPageLinks key={href} page={href} />
      ))}
    </>
  )
}
