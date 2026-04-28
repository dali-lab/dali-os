import { Outlet, redirect, useLoaderData, Link } from 'react-router'
import type { Route } from './+types/account-layout'
import { requireAuth } from '~/lib/auth'
import { prisma } from '~/lib/db'
import { getDownloadUrl } from '~/lib/s3'
import { Avatar } from '~/components/Avatar'
import { ArrowLeft } from 'lucide-react'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  // Account pages are member-only
  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
    select: { id: true, profilePictureKey: true },
  })
  if (!member) return redirect(auth.user.type === 'member' ? '/reviewer' : '/portal')

  const user = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  })

  let profilePictureUrl: string | null = null
  if (member.profilePictureKey) {
    profilePictureUrl = await getDownloadUrl(member.profilePictureKey)
  }

  return {
    user: { firstName: user?.firstName ?? '', lastName: user?.lastName ?? '' },
    profilePictureUrl,
  }
}

export default function AccountLayout() {
  const { user, profilePictureUrl } = useLoaderData<typeof loader>()

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() || '?'

  return (
    <div className="min-h-screen bg-section-bg">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-14">
          <Link to="/reviewer" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mr-4">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <Avatar src={profilePictureUrl} fallback={initials} size={28} />
            <h1 className="font-heading font-bold text-lg text-foreground">Account</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </div>
    </div>
  )
}
