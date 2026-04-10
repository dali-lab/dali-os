import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import {
  LayoutDashboard,
  FileText,
  ChevronDown,
  Trophy,
  ClipboardList,
} from 'lucide-react'
import { currentUser, adminUser } from '~/mockData'
import type { ViewMode } from '~/types'
interface LayoutProps {
  children: React.ReactNode
  viewMode: ViewMode
  setViewMode: (val: ViewMode) => void
}
const viewRoutes: Record<ViewMode, string> = {
  applicant: '/',
  mentor: '/mentor',
  domainLead: '/domain-lead',
  admin: '/admin',
}

export function Layout({ children, viewMode, setViewMode }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const user = viewMode === 'applicant' ? currentUser : adminUser
  const [showViewMenu, setShowViewMenu] = useState(false)
  const viewLabels: Record<ViewMode, string> = {
    applicant: 'Applicant View',
    mentor: 'Mentor View',
    domainLead: 'Domain Lead View',
    admin: 'Admin View',
  }
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Navigation */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 overflow-visible">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-xl leading-none">
                    D
                  </span>
                </div>
                <span className="font-bold text-xl text-gray-900 tracking-tight">
                  DALI Hiring
                </span>
              </div>

              <nav className="ml-10 flex space-x-8">
                {viewMode === 'admin' && (
                  <>
                    <Link
                      to="/admin"
                      className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${location.pathname === '/admin' || location.pathname.startsWith('/admin/cycle') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                    >
                      <LayoutDashboard className="w-4 h-4 mr-2" />
                      Cycles
                    </Link>
                    <Link
                      to="/admin/forms"
                      className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${location.pathname.startsWith('/admin/forms') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Forms
                    </Link>
                    <Link
                      to="/admin/challenges"
                      className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${location.pathname.startsWith('/admin/challenges') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                    >
                      <Trophy className="w-4 h-4 mr-2" />
                      Challenges
                    </Link>
                    <Link
                      to="/admin/rubrics"
                      className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${location.pathname.startsWith('/admin/rubrics') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                    >
                      <ClipboardList className="w-4 h-4 mr-2" />
                      Rubrics
                    </Link>
                  </>
                )}
                {viewMode === 'mentor' && (
                  <Link
                    to="/mentor"
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${location.pathname.startsWith('/mentor') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                  >
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    Dashboard
                  </Link>
                )}
                {viewMode === 'domainLead' && (
                  <Link
                    to="/domain-lead"
                    className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${location.pathname.startsWith('/domain-lead') ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
                  >
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    Dashboard
                  </Link>
                )}
              </nav>
            </div>

            <div className="flex items-center gap-4">
              {/* View Toggle for Demo Purposes */}
              <div className="relative">
                <button
                  onClick={() => setShowViewMenu(!showViewMenu)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  {viewLabels[viewMode]}
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                </button>

                {showViewMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-20"
                      onClick={() => setShowViewMenu(false)}
                    ></div>
                    <div className="absolute right-0 z-30 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none">
                      <div className="py-1" role="menu">
                        {(Object.keys(viewLabels) as ViewMode[]).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => {
                              setViewMode(mode)
                              setShowViewMenu(false)
                              navigate(viewRoutes[mode])
                            }}
                            className={`${viewMode === mode ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} block w-full text-left px-4 py-2 text-sm hover:bg-gray-50`}
                            role="menuitem"
                          >
                            {viewLabels[mode]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 border-l border-gray-200 pl-4">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-gray-900">
                    {user.firstName} {user.lastName}
                  </div>
                  <div className="text-xs text-gray-500">
                    {user.daliEmail || user.dartmouthEmail}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  {user.firstName[0]}
                  {user.lastName[0]}
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
