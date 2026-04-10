import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { Layout } from '~/components/Layout'
import { FormsProvider } from '~/context/FormsContext'
import type { ViewMode } from '~/types'

function viewModeFromPath(pathname: string): ViewMode {
  if (pathname.startsWith('/mentor')) return 'mentor'
  if (pathname.startsWith('/domain-lead')) return 'domainLead'
  if (pathname.startsWith('/admin')) return 'admin'
  return 'applicant'
}

export default function AppLayoutRoute() {
  const location = useLocation()
  const [viewMode, setViewMode] = useState<ViewMode>(() => viewModeFromPath(location.pathname))

  return (
    <FormsProvider>
      <Layout viewMode={viewMode} setViewMode={setViewMode}>
        <Outlet />
      </Layout>
    </FormsProvider>
  )
}
