import { Outlet, redirect, useLoaderData, Link, useLocation } from 'react-router'
import type { Route } from './+types/account-layout'
import { requireAuth } from '~/lib/auth'
import { prisma } from '~/lib/db'
import { getDownloadUrl } from '~/lib/s3'
import { Avatar } from '~/components/Avatar'
import { ArrowLeft, User, Plug, ShieldCheck } from 'lucide-react'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true, profilePictureKey: true },
  })

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
    select: { id: true },
  })

  let profilePictureUrl: string | null = null
  if (user?.profilePictureKey) {
    profilePictureUrl = await getDownloadUrl(user.profilePictureKey)
  }

  return {
    user: { firstName: user?.firstName ?? '', lastName: user?.lastName ?? '' },
    profilePictureUrl,
    isMember: !!member,
    authType: auth.user.type,
  }
}

const tabs = [
  { label: 'Profile', to: '/account', icon: User, memberOnly: false },
  { label: 'Integrations', to: '/account/integrations', icon: Plug, memberOnly: true },
  { label: 'Roles & Access', to: '/account/roles', icon: ShieldCheck, memberOnly: true },
]

export default function AccountLayout() {
  const { user, profilePictureUrl, isMember, authType } = useLoaderData<typeof loader>()
  const location = useLocation()

  const backTo = authType === 'member' ? '/reviewer' : '/portal'
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() || '?'

  const visibleTabs = tabs.filter((t) => !t.memberOnly || isMember)

  return (
    <div className="min-h-screen bg-section-bg">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-14">
          <Link to={backTo} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mr-4">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <Avatar src={profilePictureUrl} fallback={initials} size={28} />
            <h1 className="font-heading font-bold text-lg text-foreground">Account</h1>
          </div>
        </div>
      </div>

      {/* Content with sidebar */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row gap-8">
          {/* Sidebar */}
          <nav className="sm:w-48 flex-shrink-0">
            <ul className="flex sm:flex-col gap-1">
              {visibleTabs.map((tab) => {
                const isActive =
                  tab.to === '/account'
                    ? location.pathname === '/account'
                    : location.pathname.startsWith(tab.to)
                return (
                  <li key={tab.to}>
                    <Link
                      to={tab.to}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-accent-coral/10 text-accent-coral'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      {tab.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
