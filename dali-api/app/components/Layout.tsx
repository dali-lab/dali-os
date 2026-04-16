import React from 'react'
import { Link, useLocation } from 'react-router'
import {
  LayoutDashboard,
  Trophy,
  ClipboardList,
  LogOut,
  Users,
  Calendar,
  Shield,
  Video,
  Mail,
} from 'lucide-react'

interface LayoutProps {
  children: React.ReactNode
  user: { email: string }
  isHiringLead?: boolean
  isAdmin?: boolean
  isDomainLead?: boolean
  isInterviewer?: boolean
}

export function Layout({ children, user, isHiringLead = false, isAdmin = false, isDomainLead = false, isInterviewer = false }: LayoutProps) {
  const location = useLocation()

  const tabs = [
    {
      label: 'Reviewer Dashboard',
      to: '/reviewer',
      icon: LayoutDashboard,
      show: true,
      active: location.pathname.startsWith('/reviewer'),
    },
    {
      label: 'Domain Lead',
      to: '/domain-lead',
      icon: Shield,
      show: isDomainLead,
      active: location.pathname.startsWith('/domain-lead'),
    },
    {
      label: 'Interviewer',
      to: '/interviewer',
      icon: Video,
      show: isInterviewer,
      active: location.pathname.startsWith('/interviewer'),
    },
    {
      label: 'Challenges',
      to: '/challenges',
      icon: Trophy,
      show: isDomainLead || isHiringLead,
      active: location.pathname.startsWith('/challenges'),
    },
    {
      label: 'Rubrics',
      to: '/rubrics',
      icon: ClipboardList,
      show: isDomainLead || isHiringLead,
      active: location.pathname.startsWith('/rubrics'),
    },
    {
      label: 'Cycles',
      to: '/hiring-lead-admin',
      icon: Calendar,
      show: isHiringLead,
      active: location.pathname.startsWith('/hiring-lead-admin'),
    },
    {
      label: 'Emails',
      to: '/emails',
      icon: Mail,
      show: isHiringLead,
      active: location.pathname.startsWith('/emails'),
    },
    {
      label: 'Members',
      to: '/admin-console',
      icon: Users,
      show: isAdmin,
      active: location.pathname.startsWith('/admin-console'),
    },
  ].filter((t) => t.show)

  const initials = user.email.slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo + tabs */}
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center gap-2 mr-8">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-xl leading-none">D</span>
                </div>
                <span className="font-bold text-xl text-gray-900 tracking-tight">DALI Hiring</span>
              </div>

              <nav className="flex h-full">
                {tabs.map((tab) => (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    className={`inline-flex items-center gap-1.5 px-3 border-b-2 text-sm font-medium transition-colors ${
                      tab.active
                        ? 'border-blue-500 text-gray-900'
                        : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </Link>
                ))}
              </nav>
            </div>

            {/* User */}
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-xs text-gray-500">{user.email}</div>
              </div>
              <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                {initials}
              </div>
              <a
                href="/logout"
                className="p-1.5 text-gray-400 hover:text-gray-600 transition"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
