import { isPinnedActive, RAIL_AREA_ORDER, type NavArea, type RoleFlags, type SubTab } from '~/lib/nav-areas'
import type { FeatureFlagMap } from '~/lib/feature-flags'
import { Download, HelpCircle, Settings, Sparkles, UserRound, type LucideIcon } from 'lucide-react'

export type UserMenuEntry = { url: string; label: string; icon: LucideIcon }

export type SidebarSize = 'expanded' | 'compact'

export const RAIL_WIDTH = { expanded: 264, compact: 68, legacy: 276 } as const

export function railWidth(size: SidebarSize, scalable: boolean): number {
  return scalable ? RAIL_WIDTH[size] : RAIL_WIDTH.legacy
}

export function userMenuEntries({
  releaseNotes,
  desktopDownload,
}: {
  releaseNotes: boolean
  desktopDownload: boolean
}): UserMenuEntry[] {
  return [
    { url: '/profile', label: 'Profile', icon: UserRound },
    { url: '/settings', label: 'Settings', icon: Settings },
    ...(releaseNotes ? [{ url: '/release-notes', label: "What's new", icon: Sparkles }] : []),
    { url: '/help', label: 'Help', icon: HelpCircle },
    ...(desktopDownload ? [{ url: '/download', label: 'Get the desktop app', icon: Download }] : []),
  ]
}

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

export function orderRailAreas(areas: NavArea[]): NavArea[] {
  const rank = (key: string) => {
    const i = RAIL_AREA_ORDER.indexOf(key)
    return i === -1 ? RAIL_AREA_ORDER.length : i
  }
  return [...areas].sort((a, b) => rank(a.key) - rank(b.key))
}

function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** An upcoming meeting's trailing label: its time today, otherwise its weekday. */
export function upcomingWhen(startsAt: string, now: Date, timeZone: string): string {
  const at = new Date(startsAt)
  if (dayKey(at, timeZone) !== dayKey(now, timeZone)) {
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at)
  }
  // Newer ICU puts a narrow no-break space before AM/PM; keep the label stable across runtimes.
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    .format(at)
    .replace(/\s/g, ' ')
}
