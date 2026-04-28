import { Outlet, redirect, useLoaderData } from 'react-router'
import { Layout } from '~/components/Layout'
import { requireAuth } from '~/lib/auth'
import { getUserRoles } from '~/lib/roles'
import { getActiveCycle } from '~/lib/cycles'
import { prisma } from '~/lib/db'
import { getDownloadUrl } from '~/lib/s3'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (auth.user.type === 'applicant') return redirect('/portal')
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

  // Fetch profile picture for nav avatar (from DALIMember)
  let profilePictureUrl: string | null = null
  const memberRecord = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
    select: { profilePictureKey: true },
  })
  if (memberRecord?.profilePictureKey) {
    profilePictureUrl = await getDownloadUrl(memberRecord.profilePictureKey)
  }

  return { user: auth.user, profilePictureUrl, isHiringLead: hiringLead, isAdmin: admin, isDomainLead: domainLead, isInterviewer }
}

export default function AppLayoutRoute() {
  const { user, profilePictureUrl, isHiringLead, isAdmin, isDomainLead, isInterviewer } = useLoaderData<typeof loader>()

  return (
    <Layout user={user} profilePictureUrl={profilePictureUrl} isHiringLead={isHiringLead} isAdmin={isAdmin} isDomainLead={isDomainLead} isInterviewer={isInterviewer}>
      <Outlet />
    </Layout>
  )
}
