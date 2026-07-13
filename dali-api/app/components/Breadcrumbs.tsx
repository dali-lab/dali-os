import { Link, useMatches, useLocation } from 'react-router'
import { ChevronRight } from 'lucide-react'

export type Crumb = { label: string; to?: string }

// A route opts into a dynamic leaf crumb by exporting:
//   export const handle = { breadcrumb: (data) => data.application.applicantName }
// The component calls it with that route's loader data to resolve the last
// crumb (e.g. an applicant's name in place of a raw id). Returning a Crumb[]
// instead expands the segment into a sub-trail — for hierarchy the flat URL
// can't express, like nested folder ancestry (/forms/:folderId).
// A route that renders an AreaPillNav row instead exports
//   export const handle = { areaPills: true }
// which suppresses the trail entirely — see the wayfinding contract below.
type Handle = {
  breadcrumb?: (data: unknown) => string | Crumb[] | null | undefined
  areaPills?: boolean
}

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

  'admin-console': 'Admin',
  members: 'People',
  groups: 'Groups',
  domains: 'Domains',
  announcements: 'Announcements',
  activity: 'Activity',
  'payroll-export': 'Payroll Export',

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
  'documents', // /documents/:pageId only — no bare /documents index
  'file',
  'edit', // /forms/edit/:formId
  'challenges',
  'rubrics',
  'confidentiality-agreements',
  'cycle', // /hiring/lead/cycle/:id
  'cycles', // /hiring/cycles/:cycleId/confidentiality
  'intern-to-full-cycle',
  'application', // /hiring/{reviewer,domain-lead}/application/:id
  'delibs',
  'assignments', // /education/manage/assignments/:assignmentId
  'page',
  'certificates',
])

// Opaque database ids that would render as gibberish in a trail: cuids
// (25 lowercase alphanumerics starting with "c"), other long unhyphenated
// tokens, and UUIDs. Human-slugged ids ("offering-figma-workshop") don't
// match and still titlecase readably.
function isOpaqueId(seg: string) {
  return /^[a-z0-9]{20,}$/i.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
}

export function Breadcrumbs() {
  const matches = useMatches()
  const { pathname } = useLocation()

  // Wayfinding contract with AreaPillNav: exactly one row per page. Landing
  // pages carry a pill row (the active pill marks the location, the Hub pill
  // carries the way back up) and flag it via handle.areaPills, which
  // suppresses the trail here. Detail pages have no pills, so breadcrumbs
  // are their trail back.
  if (matches.some((m) => (m as { handle?: Handle }).handle?.areaPills)) {
    return null
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
  let afterDroppedId = false
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!
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
          crumbs.push({ label: c.label, to: leaf ? undefined : c.to })
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

  // Home / single-segment pages get no trail.
  if (crumbs.length <= 1) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
    >
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-3.5 h-3.5 opacity-50" />}
          {c.to ? (
            <Link to={c.to} className="hover:text-foreground transition-colors">
              {c.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
