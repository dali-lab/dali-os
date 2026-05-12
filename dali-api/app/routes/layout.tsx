import { useEffect, useState } from 'react'
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

  // After a client-side navigation inside the workspace iframe, the loader
  // re-runs via fetch — which carries `Sec-Fetch-Dest: empty`, not `iframe` —
  // and `?embed=1` is stripped from the URL by the navigation. Both server
  // signals go stale, so we also check on the client: if our window isn't the
  // top window, we're embedded. Initialized post-mount to avoid a hydration
  // mismatch (the initial document load is correctly resolved by the loader).
  const [isClientEmbedded, setIsClientEmbedded] = useState(false)
  useEffect(() => {
    try {
      setIsClientEmbedded(window.self !== window.top)
    } catch {
      // Cross-origin access throws → we're embedded somewhere we can't see.
      setIsClientEmbedded(true)
    }
  }, [])

  // Skip the sidebar shell when rendered inside a TabWorkspace iframe.
  if (isEmbedded || isClientEmbedded || searchParams.get('embed') === '1') {
    return (
      <div className="min-h-dvh bg-section-bg">
        <div className="w-full px-3 sm:px-6 lg:px-10 pt-4 sm:pt-8 md:pt-12 pb-6 sm:pb-8">
          <Outlet />
        </div>
      </div>
    )
  }

  return (
    <Layout user={user} isHiringLead={isHiringLead} isAdmin={isAdmin} isDomainLead={isDomainLead} isInterviewer={isInterviewer} />
  )
}
