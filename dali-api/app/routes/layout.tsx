import { Outlet, redirect, useLoaderData, useSearchParams } from 'react-router'
import { Layout } from '~/components/Layout'
import { requireAuth, withAuth } from '~/lib/auth'
import { getUserRoles } from '~/lib/roles'
import { getActiveCycle } from '~/hiring/lib/cycles'
import { prisma } from '~/lib/db'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return withAuth(auth, redirect('/login'))
  if (auth.user.type === 'applicant') return withAuth(auth, redirect('/portal'))
  const { memberId, isHiringLead: hiringLead, isAdmin: admin, isDomainLead: domainLead } = await getUserRoles(auth.user.sub)

  let isInterviewer = false
  if (memberId) {
    const active = await getActiveCycle()
    if (active) {
      const interviewer = await prisma.cycleInterviewer.findFirst({
        where: { daliMemberId: memberId, applicationCycleId: active.id },
      })
      isInterviewer = !!interviewer
    }
  }

  // Detect iframe context from Sec-Fetch-Dest. Modern browsers (Chrome, Firefox,
  // Safari 16+) set this automatically and it survives server-side redirects,
  // so it works even when ?embed=1 gets stripped from a redirect Location.
  const fetchDest = request.headers.get('sec-fetch-dest')
  const isEmbedded = fetchDest === 'iframe' || fetchDest === 'frame'

  return withAuth(auth, { user: auth.user, isHiringLead: hiringLead, isAdmin: admin, isDomainLead: domainLead, isInterviewer, isEmbedded })
}

export default function AppLayoutRoute() {
  const { user, isHiringLead, isAdmin, isDomainLead, isInterviewer, isEmbedded } = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()

  // Skip the sidebar shell when rendered inside a TabWorkspace iframe.
  // Prefer the server-detected `isEmbedded` (works after redirects); fall back
  // to the `?embed=1` query param for clients that don't send Sec-Fetch-Dest.
  if (isEmbedded || searchParams.get('embed') === '1') {
    return (
      <div className="min-h-screen bg-section-bg">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-8 lg:px-12 py-6 md:py-8">
          <Outlet />
        </div>
      </div>
    )
  }

  return (
    <Layout user={user} isHiringLead={isHiringLead} isAdmin={isAdmin} isDomainLead={isDomainLead} isInterviewer={isInterviewer}>
      <Outlet />
    </Layout>
  )
}
