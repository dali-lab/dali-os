import type { Crumb } from '~/components/Breadcrumbs'
import type { FeatureFlagMap } from '~/lib/feature-flags'
import { areaForPath, areasForViewer, owningSubtab, type RoleFlags, type SubTab } from '~/lib/nav-areas'

type SectionRoot = { label: string; to: string }
type Viewer = Pick<RoleFlags, 'isAlumni' | 'isNewMember'>

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

export function sectionRoot(url: string, flags: Partial<FeatureFlagMap> = {}, roles?: Viewer): SectionRoot | null {
  const p = pathnameOf(url)
  const destination = destinationFor(p)
  if (destination) return destination
  const area = areaForPath(p, flags, roles)
  return area ? { label: area.label, to: area.hubPath } : null
}

/** The viewer's deepest sub-tab at or above this path. */
function subtabFor(url: string, flags: Partial<FeatureFlagMap>, roles?: Viewer): SubTab | undefined {
  const p = pathnameOf(url)
  let best: SubTab | undefined
  for (const area of areasForViewer(roles, flags)) {
    for (const t of area.subtabs) {
      const under = p === t.href || p.startsWith(t.href + '/')
      if (under && t.href.length > (best?.href.length ?? -1)) best = t
    }
  }
  return best
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
  roles,
}: {
  path: string
  trail: Crumb[]
  title: string
  flags?: Partial<FeatureFlagMap>
  roles?: Viewer
}): Crumb[] {
  const p = pathnameOf(path)
  if (p === '/') return [{ label: 'Home' }]
  const subtab = subtabFor(path, flags, roles)
  const leaf = (subtab?.href === p ? subtab.label : undefined) ?? title
  // Url segments above the page's own sub-tab (Community over Gallery) aren't its parents in the rail.
  const own = trail
    .filter((c) => !(subtab && c.to && subtab.href.startsWith(c.to + '/')))
    .map((c) => {
      const owner = c.to ? owningSubtab(c.to, flags, roles) : undefined
      return owner && pathnameOf(c.to!) === owner.owns ? { ...c, label: owner.label, to: owner.href } : c
    })
  const base = own.length > 1 ? own : leaf ? [{ label: leaf }] : own
  // A route that declares its own trail (a project file under /documents) names
  // its home in its first crumb, which beats the url's prefix.
  const anchor = own.length > 1 && own[0]?.to ? own[0].to : path
  const root = sectionRoot(anchor, flags, roles)
  const rest = root && base[0]?.label === root.label ? base.slice(1) : base
  const crumbs: Crumb[] = root ? [{ label: root.label, to: root.to }, ...rest] : rest
  return crumbs.map((c, i) => (i === crumbs.length - 1 ? { ...c, to: undefined } : c))
}
