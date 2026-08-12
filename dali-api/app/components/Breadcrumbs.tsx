import type { ReactNode } from 'react'
import { Link, useMatches, useLocation } from 'react-router'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '~/lib/cn'
import { Menu } from '~/components/ui/floating'
import { FavoriteRouteButton } from '~/components/FavoriteRouteButton'
import { isNavbarRoute } from '~/lib/navbar-routes'
import { isAreaSubtabPath } from '~/lib/nav-areas'

export type Crumb = {
  label: string
  to?: string
  icon?: ReactNode
  // When set, the crumb renders as a dropdown "switcher" listing sibling
  // destinations (nested areas like Admin use this for lateral navigation).
  // `current` marks the active sibling. Purely additive — crumbs without
  // `siblings` render exactly as before.
  siblings?: { label: string; to: string; current?: boolean }[]
}

// A route opts into a dynamic leaf crumb by exporting:
//   export const handle = { breadcrumb: (data) => data.application.applicantName }
// The component calls it with that route's loader data to resolve the last
// crumb (e.g. an applicant's name in place of a raw id). Returning a Crumb[]
// instead expands the segment into a sub-trail — for hierarchy the flat URL
// can't express, like nested folder ancestry (/forms/:folderId).
// A route that renders an AreaPillNav row instead exports
//   export const handle = { areaPills: true }
// which suppresses the trail entirely — see the wayfinding contract below.
// A route can also render a page-specific action at the far right of this
// same row via `handle.headerAction(data)` (e.g. a "Partner view" button) —
// only the deepest matching route's action is used.
//
// When a route's URL prefix does NOT match the item's conceptual home — e.g.
// the shared /documents/* file viewer showing a *project* file, whose home is
// Projects, not Documents — the leaf-only `breadcrumb` above can't help: it can
// relabel its own segment but never the inherited prefix crumbs. Such a route
// exports
//   export const handle = { breadcrumbTrail: (data) => Crumb[] }
// to declare its ENTIRE trail; the deepest match's non-empty return replaces
// the URL-derived crumbs wholesale.
type Handle = {
  breadcrumb?: (data: unknown) => string | Crumb[] | null | undefined
  breadcrumbTrail?: (data: unknown) => Crumb[] | null | undefined
  areaPills?: boolean
  headerAction?: (data: unknown) => ReactNode
  // A page opts into a documentation guide by declaring a stable docKey (and an
  // optional human title). PageDocButton (rendered globally in the layout)
  // surfaces the "Docs" button for the deepest match that sets one — see
  // app/components/page-docs/PageDocButton.tsx.
  docKey?: string
  docTitle?: string
  /** DB-backed detail pages (project, person, partner org) — star sits inline
   *  after the trail, not in the layout header. */
  favoriteRoute?: boolean
}

// Shared shape so PageDocButton can read the same handle contract. Exported
// separately from the internal Handle type to keep this module's default export
// focused on breadcrumbs.
export type DocHandle = { docKey?: string; docTitle?: string }

// Static label map for the fixed path segments. Keeps lab vocabulary verbatim
// (Domain, Delibs, Intent to Work, Project Bids, JobX, Level Up, Core, Hub,
// Library). Unknown segments fall back to titlecase. Area labels mirror the
// sidebar (People / Lab Processes / Admin / Documents).
const SEGMENT_LABELS: Record<string, string> = {
  hiring: 'Hiring',
  applications: 'Applications',
  reviewer: 'Reviews',
  'domain-lead': 'Domain',
  delibs: 'Delibs',
  lead: 'Cycles',
  cycles: 'Cycles',
  waitlists: 'Waitlists',
  library: 'Library',
  challenges: 'Challenges',
  rubrics: 'Rubrics',
  'confidentiality-agreements': 'Confidentiality',
  confidentiality: 'Confidentiality',
  emails: 'Emails',
  interviews: 'Interviews',

  'admin': 'Admin',
  members: 'People',
  groups: 'Groups',
  domains: 'Domains',
  announcements: 'Announcements',
  activity: 'Activity',
  'payroll-export': 'Payroll: Hire Setup',
  payroll: 'Payroll: Reconcile',

  projects: 'Projects',
  staffing: 'Staffing',
  'my-staffing': 'My Staffing',
  'level-up': 'Level Up',
  'intent-to-work': 'Intent to Work',
  'project-bids': 'Project Bids',

  partners: 'Partners',
  education: 'Education',

  'internal-processes': 'Lab Processes',
  onboarding: 'Onboarding',
  transfer: 'Transfer',
  jobx: 'JobX',

  manage: 'Manage',
  compliance: 'CE Compliance',
  hub: 'Course Hub',
  assignments: 'Assignments',
  page: 'Materials',
  apply: 'Apply',
  certificates: 'Certificates',

  documents: 'Documents',
  forms: 'Forms',
  calendar: 'Calendar',
  mentorship: 'Mentorship',
  profile: 'Profile',
  settings: 'Settings',
  help: 'Help',
}

function titleCase(seg: string) {
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Path segments that only ever appear as prefixes of detail routes — the
// prefix itself is not a routable page (e.g. /hiring/challenges has no list;
// the Library owns it). These stay in the trail as labels but never link,
// so a crumb can't 404.
const UNROUTED_SEGMENTS = new Set([
  // NB: 'documents' is routable now (the Documents hub lives at /documents),
  // so it links back there from a document's trail.
  'challenges',
  'rubrics',
  'confidentiality-agreements',
  'cycle', // /hiring/lead/cycle/:id
  'cycles', // /hiring/cycles/:cycleId/confidentiality
  'intern-to-full-cycle',
  'delibs',
  'assignments', // /education/manage/assignments/:assignmentId
  'page',
  'certificates',
])

// Structural URL segments that carry no location of their own — the sibling
// dynamic segment's route supplies the real sub-trail (e.g. /forms/edit/:id
// expands into folder ancestry + form name, and /forms/responses/:id adds a
// "Responses" leaf itself). Rendered as nothing rather than as a crumb.
const DROPPED_SEGMENTS = new Set([
  'edit', // /forms/edit/:formId
  'responses', // /forms/responses/:formId
  'file', // /documents/file/:fileId — the fileId segment supplies its own sub-trail
  'application', // /hiring/{reviewer,domain-lead}/application/:id — the :id leaf names the applicant
  'notes', // /mentorship/notes/:id — leaf breadcrumb links back to /mentorship/browse
  // /calendar/check-in/:id — no /calendar/check-in index; leaf breadcrumb names the meeting
  'check-in',
])

// Opaque database ids that would render as gibberish in a trail: cuids
// (25 lowercase alphanumerics starting with "c"), other long unhyphenated
// tokens, and UUIDs. Human-slugged ids ("offering-figma-workshop") don't
// match and still titlecase readably.
function isOpaqueId(seg: string) {
  return /^[a-z0-9]{20,}$/i.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
}

// A breadcrumb crumb that is also a switcher: clicking it opens a menu of
// sibling destinations.
function CrumbSwitcher({
  label,
  siblings,
}: {
  label: string
  siblings: NonNullable<Crumb['siblings']>
}) {
  return (
    <Menu
      align="left"
      ariaLabel={`${label} siblings`}
      trigger={(open) => (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-foreground transition hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral"
        >
          {label}
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      )}
    >
      {siblings.map((s) => (
        <Menu.LinkItem
          key={s.to}
          to={s.to}
          icon={
            <Check
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-accent-coral',
                s.current ? 'opacity-100' : 'opacity-0',
              )}
              aria-hidden
            />
          }
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 text-sm transition hover:bg-muted/50',
            s.current ? 'font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          {s.label}
        </Menu.LinkItem>
      ))}
    </Menu>
  )
}

export function Breadcrumbs() {
  const matches = useMatches()
  const { pathname, search } = useLocation()

  // Wayfinding contract with AreaPillNav: exactly one row per page. Landing
  // pages carry a pill row (the active pill marks the location, the Hub pill
  // carries the way back up) and flag it via handle.areaPills, which
  // suppresses the trail here. Detail pages have no pills, so breadcrumbs
  // are their trail back.
  if (matches.some((m) => (m as { handle?: Handle }).handle?.areaPills)) {
    return null
  }

  // A route whose home differs from its URL prefix owns the whole trail via
  // handle.breadcrumbTrail — the deepest match wins and short-circuits the
  // segment walk below. The last crumb never links (same invariant the walk
  // enforces).
  let fullTrail: Crumb[] | null = null
  for (const m of matches as { handle?: Handle; data?: unknown }[]) {
    if (m.handle?.breadcrumbTrail && m.data != null) {
      const t = m.handle.breadcrumbTrail(m.data)
      if (t && t.length > 0) fullTrail = t
    }
  }

  // Build crumbs from the path segments. Any matched route may supply a
  // dynamic label for its own path via `handle.breadcrumb(loaderData)`;
  // in flat-route land that's usually just the leaf, so unlabeled dynamic
  // segments in the middle of the path (raw cuids) are dropped from the
  // trail instead of rendered verbatim.
  const segments = pathname.split('/').filter(Boolean)
  const labelByPath = new Map<string, string | Crumb[]>()
  for (const m of matches as { pathname: string; handle?: Handle; data?: unknown }[]) {
    if (m.handle?.breadcrumb && m.data != null) {
      const label = m.handle.breadcrumb(m.data)
      if (label && (!Array.isArray(label) || label.length > 0)) {
        labelByPath.set(m.pathname.replace(/\/$/, ''), label)
      }
    }
  }

  const crumbs: Crumb[] = []
  if (fullTrail) {
    fullTrail.forEach((c, i) => {
      const leaf = i === fullTrail!.length - 1
      crumbs.push({ label: c.label, to: leaf ? undefined : c.to, icon: c.icon, siblings: c.siblings })
    })
  }
  let afterDroppedId = false
  for (let i = 0; !fullTrail && i < segments.length; i += 1) {
    const seg = segments[i]!
    if (DROPPED_SEGMENTS.has(seg)) continue
    const to = '/' + segments.slice(0, i + 1).join('/')
    const isLast = i === segments.length - 1
    // Once an opaque id has been dropped, later prefixes still contain it and
    // aren't guaranteed to be real routes (e.g. /education/<id>/assignments
    // has no index page) — keep the labels but stop linking them. Same for
    // segments that are only detail-route prefixes.
    const linkable = !isLast && !afterDroppedId && !UNROUTED_SEGMENTS.has(seg)
    const dynamicLabel = labelByPath.get(to)
    if (dynamicLabel) {
      if (Array.isArray(dynamicLabel)) {
        // Sub-trail entries link as the route gave them, except the trail
        // must never end on a link.
        dynamicLabel.forEach((c, j) => {
          const leaf = isLast && j === dynamicLabel.length - 1
          crumbs.push({ label: c.label, to: leaf ? undefined : c.to, icon: c.icon, siblings: c.siblings })
        })
      } else {
        crumbs.push({ label: dynamicLabel, to: linkable ? to : undefined })
      }
      continue
    }
    if (isOpaqueId(seg)) {
      // A trailing id with no route-provided label still needs a crumb so the
      // trail doesn't end on a link; anything mid-path just drops out.
      if (isLast) crumbs.push({ label: 'Details' })
      else afterDroppedId = true
      continue
    }
    crumbs.push({
      label: SEGMENT_LABELS[seg] ?? titleCase(seg),
      to: linkable ? to : undefined,
    })
  }

  // Deepest match wins — only ever one route in practice defines this.
  let action: ReactNode = null
  let favoriteRoute = false
  for (const m of matches as { handle?: Handle; data?: unknown }[]) {
    if (m.handle?.headerAction && m.data != null) {
      action = m.handle.headerAction(m.data)
    }
    if (m.handle?.favoriteRoute) favoriteRoute = true
  }
  // Area sub-tab landing pages (Staffing, Intent to Work, Manage, …) are directly
  // pinnable too, without each route opting in via handle.
  if (!favoriteRoute && isAreaSubtabPath(pathname)) favoriteRoute = true
  if (favoriteRoute && isNavbarRoute(`${pathname}${search}`)) favoriteRoute = false

  // Home / single-segment pages get no trail (but still show a page action).
  if (crumbs.length <= 1) {
    return action ? <div className="flex justify-end w-full">{action}</div> : null
  }

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap w-full min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
        >
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
              {c.icon}
              {c.siblings ? (
                <CrumbSwitcher label={c.label} siblings={c.siblings} />
              ) : c.to ? (
                <Link to={c.to} className="hover:text-foreground transition-colors">
                  {c.label}
                </Link>
              ) : (
                <span className="text-foreground font-medium">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
        {favoriteRoute && <FavoriteRouteButton inline />}
      </div>
      {action}
    </div>
  )
}
