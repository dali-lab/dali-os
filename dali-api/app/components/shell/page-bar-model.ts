import type { Crumb } from '~/components/Breadcrumbs'
import type { FeatureFlagMap } from '~/lib/feature-flags'
import { areaForPath } from '~/lib/nav-areas'

type SectionRoot = { label: string; to: string }

const DESTINATIONS: { prefixes: string[]; root: SectionRoot }[] = [
  { prefixes: ['/calendar', '/rooms'], root: { label: 'Calendar', to: '/calendar' } },
  { prefixes: ['/email'], root: { label: 'Email', to: '/email' } },
  { prefixes: ['/drive', '/documents'], root: { label: 'Drive', to: '/drive' } },
]

function pathnameOf(url: string): string {
  const cut = url.search(/[?#]/)
  return cut < 0 ? url : url.slice(0, cut)
}

function destinationFor(pathname: string): SectionRoot | null {
  const hit = DESTINATIONS.find((d) =>
    d.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/')),
  )
  return hit?.root ?? null
}

export function sectionRoot(url: string, flags: Partial<FeatureFlagMap> = {}): SectionRoot | null {
  const p = pathnameOf(url)
  const destination = destinationFor(p)
  if (destination) return destination
  const area = areaForPath(p, flags)
  return area ? { label: area.label, to: area.hubPath } : null
}

/** A tab's name when its page sets no title of its own. */
export function fallbackPageLabel(url: string): string {
  const p = pathnameOf(url)
  if (p === '/') return 'Home'
  return destinationFor(p)?.label ?? ''
}

/**
 * The page bar's trail: always the section the page belongs to (Lab, Core,
 * Calendar, Drive...), then the route's own trail, or the page title when the
 * route has none. The leaf never links.
 */
export function pageBarCrumbs({
  path,
  trail,
  title,
  flags = {},
}: {
  path: string
  trail: Crumb[]
  title: string
  flags?: Partial<FeatureFlagMap>
}): Crumb[] {
  if (pathnameOf(path) === '/') return [{ label: 'Home' }]
  const base = trail.length > 1 ? trail : title ? [{ label: title }] : trail
  // A route that declares its own trail (a project file under /documents) names
  // its home in its first crumb, which beats the url's prefix.
  const anchor = trail.length > 1 && trail[0]?.to ? trail[0].to : path
  const root = sectionRoot(anchor, flags)
  const rest = root && base[0]?.label === root.label ? base.slice(1) : base
  const crumbs: Crumb[] = root ? [{ label: root.label, to: root.to }, ...rest] : rest
  return crumbs.map((c, i) => (i === crumbs.length - 1 ? { ...c, to: undefined } : c))
}
