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
  FileText,
  MessageSquare,
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
  const path = location.pathname

  // Build navigation structure with sub-items
  const sections = [
    {
      label: 'Domain',
      to: '/domain-lead',
      icon: Shield,
      show: isDomainLead,
      active: path.startsWith('/domain-lead'),
      sub: null,
    },
    {
      label: 'Reviews',
      to: '/reviewer',
      icon: MessageSquare,
      show: true,
      active: path.startsWith('/reviewer') || path.startsWith('/interviewer'),
      sub: isInterviewer ? [
        { label: 'Applications', to: '/reviewer', active: path.startsWith('/reviewer') },
        { label: 'Interviews', to: '/interviewer', active: path.startsWith('/interviewer') },
      ] : null,
    },
    {
      label: 'Cycles',
      to: '/hiring-lead-admin',
      icon: Calendar,
      show: isHiringLead,
      active: path.startsWith('/hiring-lead-admin') || path.startsWith('/challenges') || path.startsWith('/rubrics'),
      sub: [
        { label: 'Overview', to: '/hiring-lead-admin', active: path.startsWith('/hiring-lead-admin') },
        { label: 'Challenges', to: '/challenges', active: path.startsWith('/challenges') },
        { label: 'Rubrics', to: '/rubrics', active: path.startsWith('/rubrics') },
      ],
    },
    {
      label: 'Members',
      to: '/admin-console',
      icon: Users,
      show: isAdmin,
      active: path.startsWith('/admin-console'),
      sub: null,
    },
  ].filter((s) => s.show)

  const activeSection = sections.find((s) => s.active)
  const initials = user.email.slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar — logo, user */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-base leading-none">D</span>
            </div>
            <span className="font-bold text-lg text-gray-900 tracking-tight">DALI Hiring</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block">{user.email}</span>
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
              {initials}
            </div>
            <a href="/logout" className="text-gray-400 hover:text-gray-600 transition" title="Log out">
              <LogOut className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Navigation bar — primary tabs + sub-tabs inline */}
      <div className="bg-white border-b border-gray-100 sticky top-14 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6 h-10">
            {/* Primary tabs */}
            <nav className="flex items-center gap-1 -mb-px h-full">
              {sections.map((section) => (
                <Link
                  key={section.to}
                  to={section.to}
                  className={`inline-flex items-center gap-1.5 px-3 h-full border-b-2 text-sm font-medium transition-colors whitespace-nowrap ${
                    section.active
                      ? 'border-blue-600 text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <section.icon className="w-3.5 h-3.5" />
                  {section.label}
                </Link>
              ))}
            </nav>

            {/* Separator + sub-tabs (if active section has them) */}
            {activeSection?.sub && (
              <>
                <div className="w-px h-5 bg-gray-200" />
                <nav className="flex items-center gap-0.5">
                  {activeSection.sub.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                        item.active
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </>
            )}
          </div>
        </div>
      </div>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
