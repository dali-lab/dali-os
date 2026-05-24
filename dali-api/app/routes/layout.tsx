import { useEffect, useState } from 'react'
import { Outlet, redirect, useLoaderData, useSearchParams } from 'react-router'
import { Layout } from '~/components/Layout'
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from '~/lib/roles'
import { getActiveCycle } from '~/hiring/lib/cycles'
import { prisma } from '~/lib/db'
import { resolvePhotoUrl } from '~/lib/photo'
import { recordPageView } from '~/lib/analytics'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (auth.user.type === 'applicant') return redirect('/portal')
  const {
    isLabMember,
    isCore: core,
    isAdmin: admin,
    isDomainLead: domainLead,
    canViewForms,
    canViewStaffing,
  } = await getUserRoles(auth.user.sub)

  let isInterviewer = false
  if (isLabMember) {
    const active = await getActiveCycle()
    if (active) {
      const interviewer = await prisma.cycleInterviewer.findFirst({
        where: { userId: auth.user.sub, applicationCycleId: active.id },
      })
      isInterviewer = !!interviewer
    }
  }

  // Drives the sidebar footer avatar. The loader runs on every shell
  // load/revalidation, so this stays in sync after a profile edit.
  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { photoUrl: true },
  })
  const photoUrl = await resolvePhotoUrl(me?.photoUrl)

  // Detect iframe context from Sec-Fetch-Dest. Modern browsers (Chrome, Firefox,
  // Safari 16+) set this automatically and it survives server-side redirects,
  // so it works even when ?embed=1 gets stripped from a redirect Location.
  const fetchDest = request.headers.get('sec-fetch-dest')
  const isEmbedded = fetchDest === 'iframe' || fetchDest === 'frame'

  // Pageview is fire-and-forget — never blocks the response.
  recordPageView({
    request,
    userId: auth.user.sub,
    sessionId: auth.sessionId,
  })

  return { user: auth.user, photoUrl, isCore: core, isAdmin: admin, isDomainLead: domainLead, canViewForms, canViewStaffing, isInterviewer, isEmbedded }
}

export default function AppLayoutRoute() {
  const { user, photoUrl, isCore, isAdmin, isDomainLead, canViewForms, canViewStaffing, isInterviewer, isEmbedded } = useLoaderData<typeof loader>()
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

  const embedded = isEmbedded || isClientEmbedded || searchParams.get('embed') === '1'

  // When embedded, announce our preferred tab label to the parent workspace.
  // Source: document.title (set by each route's Route.MetaFunction), with the
  // shared `· DALI OS` suffix stripped. setTimeout(0) gives React Router a
  // tick to write the title from meta before we read it.
  useEffect(() => {
    if (!embedded) return
    if (typeof window === 'undefined') return
    const id = window.setTimeout(() => {
      const raw = document.title
      const label = raw.replace(/\s*·\s*DALI OS\s*$/, '').trim() || raw
      if (!label) return
      window.parent.postMessage(
        {
          type: 'dali:setTabLabel',
          url: window.location.pathname + window.location.search,
          label,
        },
        window.location.origin,
      )
    }, 50)
    return () => window.clearTimeout(id)
  }, [embedded])

  // Skip the sidebar shell when rendered inside a TabWorkspace iframe.
  if (embedded) {
    return (
      <div className="min-h-dvh bg-page overflow-x-hidden">
        <div className="w-full px-3 sm:px-6 lg:px-10 pt-4 sm:pt-8 md:pt-12 pb-6 sm:pb-8">
          <Outlet />
        </div>
      </div>
    )
  }

  return (
    <Layout user={user} photoUrl={photoUrl} isCore={isCore} isAdmin={isAdmin} isDomainLead={isDomainLead} canViewForms={canViewForms} canViewStaffing={canViewStaffing} isInterviewer={isInterviewer} />
  )
}
