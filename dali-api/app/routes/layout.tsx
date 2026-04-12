import { useState } from 'react'
import { Outlet, useLocation, redirect, useLoaderData } from 'react-router'
import { Layout } from '~/components/Layout'
import type { ViewMode } from '~/types'
import { requireAuth } from '~/lib/auth'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  return { user: auth.user }
}

function viewModeFromPath(pathname: string): ViewMode {
  if (pathname.startsWith('/mentor')) return 'mentor'
  if (pathname.startsWith('/domain-lead')) return 'domainLead'
  if (pathname.startsWith('/admin')) return 'admin'
  return 'mentor'
}

export default function AppLayoutRoute() {
  const { user } = useLoaderData<typeof loader>()
  const location = useLocation()
  const [viewMode, setViewMode] = useState<ViewMode>(() => viewModeFromPath(location.pathname))

  return (
    <Layout viewMode={viewMode} setViewMode={setViewMode} user={user}>
      <Outlet />
    </Layout>
  )
}
