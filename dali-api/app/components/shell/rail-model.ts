import { isPinnedActive, type RoleFlags, type SubTab } from '~/lib/nav-areas'
import type { FeatureFlagMap } from '~/lib/feature-flags'

export const FAVORITES_COLLAPSED_COUNT = 3

function pathnameOf(path: string): string {
  const cut = path.search(/[?#]/)
  return cut === -1 ? path : path.slice(0, cut)
}

/** 'home' | 'calendar' | 'email' | a pinned item's href, or null off the quick row. */
export function activeQuickItem(
  path: string,
  {
    home = '/',
    pinned = [],
    flags = {},
    roles,
  }: {
    home?: string
    pinned?: readonly SubTab[]
    flags?: Partial<FeatureFlagMap>
    roles?: Pick<RoleFlags, 'isAlumni' | 'isNewMember'>
  } = {},
): string | null {
  const p = pathnameOf(path)
  if (p === home) return 'home'
  if (p.startsWith('/calendar')) return 'calendar'
  if (p.startsWith('/email')) return 'email'
  return pinned.find((i) => isPinnedActive(path, i.href, flags, roles))?.href ?? null
}

export function splitFavorites<T>(
  favorites: readonly T[],
  expanded: boolean,
  limit = FAVORITES_COLLAPSED_COUNT,
): { visible: T[]; hiddenCount: number; canToggle: boolean } {
  const overflow = Math.max(0, favorites.length - limit)
  return {
    visible: expanded ? [...favorites] : favorites.slice(0, limit),
    hiddenCount: expanded ? 0 : overflow,
    canToggle: overflow > 0,
  }
}

export function badgeLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}
