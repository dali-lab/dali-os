import { Link, useMatches, useLocation } from 'react-router'
import { ChevronRight } from 'lucide-react'

export type Crumb = { label: string; to?: string }

// A route opts into a dynamic crumb by exporting:
//   export const handle = { breadcrumb: (data) => data.offering.title }
// The component calls each match's resolver for its own path segment, so
// intermediate layout routes (e.g. an enrolled offering layout) can supply
// dynamic labels even when they are not the leaf match.
type Handle = { breadcrumb?: (data: unknown) => string | null | undefined }

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
  interviewer: 'Interviews',
  interview: 'Interview',
  analytics: 'Analytics',

  'admin-console': 'Admin',
  members: 'People',
  domains: 'Domains',
  announcements: 'Announcements',
  activity: 'Activity',
  'payroll-export': 'Payroll export',

  projects: 'Projects',
  list: 'Hub',
  staffing: 'Staffing',
  'my-staffing': 'My Staffing',
  'level-up': 'Level Up',
  'intent-to-work': 'Intent to Work',
  'project-bids': 'Project Bids',

  partners: 'Partners',
  education: 'Education',
  enrolled: 'My Learning',
  offerings: 'Offerings',
  manage: 'Manage',
  sessions: 'Sessions',
  assignments: 'Assignments',
  discussions: 'Discussions',
  grades: 'Grades',
  templates: 'Templates',

  'internal-processes': 'Lab Processes',
  onboarding: 'Onboarding',
  transfer: 'Transfer',
  jobx: 'JobX',

  documents: 'Documents',
  forms: 'Documents',
  calendar: 'Calendar',
  profile: 'Profile',
  settings: 'Settings',
  help: 'Help',
}

function titleCase(seg: string) {
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function Breadcrumbs() {
  const allMatches = useMatches() as { handle?: Handle; data?: unknown; pathname: string }[]
  const { pathname } = useLocation()

  // Build crumbs from the path segments. Each matched route may supply a
  // dynamic label via its `handle.breadcrumb(loaderData)`, covering both the
  // leaf and intermediate layout routes (e.g. an offering title in the middle
  // of a nested manage/enrolled path).
  const segments = pathname.split('/').filter(Boolean)

  const crumbs: Crumb[] = segments.map((seg, i) => {
    const segPath = '/' + segments.slice(0, i + 1).join('/')
    const isLast = i === segments.length - 1

    // Find the deepest match whose pathname aligns with this segment's path
    // and that exposes a breadcrumb resolver.
    const match = [...allMatches].reverse().find(
      (m) =>
        (m.pathname === segPath || m.pathname === segPath + '/') &&
        m.handle?.breadcrumb != null,
    )
    const dynamicLabel =
      match?.handle?.breadcrumb && match.data != null
        ? match.handle.breadcrumb(match.data)
        : null

    if (dynamicLabel) {
      return { label: dynamicLabel, to: isLast ? undefined : segPath }
    }
    return {
      label: SEGMENT_LABELS[seg] ?? titleCase(seg),
      to: isLast ? undefined : segPath,
    }
  })

  // Home / single-segment pages get no trail.
  if (crumbs.length <= 1) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden md:flex items-center gap-1 text-sm text-muted-foreground"
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
