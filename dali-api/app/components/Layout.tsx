import React, { useState, useEffect } from 'react'
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
  FileText,
  MessageSquare,
  Menu,
  X,
} from 'lucide-react'
import { userInitials } from '~/lib/display'

interface LayoutProps {
  children: React.ReactNode
  user: { email: string; firstName?: string; lastName?: string }
  isHiringLead?: boolean
  isAdmin?: boolean
  isDomainLead?: boolean
  isInterviewer?: boolean
}

export function Layout({ children, user, isHiringLead = false, isAdmin = false, isDomainLead = false, isInterviewer = false }: LayoutProps) {
  const location = useLocation()
  const path = location.pathname
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => {
    setMobileNavOpen(false)
  }, [path])

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
      sub: null,
    },
    {
      label: 'Cycles',
      to: '/hiring-lead-admin',
      icon: Calendar,
      show: isHiringLead,
      active: path.startsWith('/hiring-lead-admin'),
      sub: null,
    },
    {
      label: 'Library',
      to: '/challenges',
      icon: FileText,
      show: isHiringLead || isDomainLead,
      active: path.startsWith('/challenges') || path.startsWith('/rubrics'),
      sub: [
        { label: 'Challenges', to: '/challenges', active: path.startsWith('/challenges') },
        { label: 'Rubrics', to: '/rubrics', active: path.startsWith('/rubrics') },
      ],
    },
    {
      label: 'Emails',
      to: '/emails',
      icon: Mail,
      show: isHiringLead,
      active: location.pathname.startsWith('/emails'),
    },
    {
      label: 'Admin',
      to: '/admin-console',
      icon: Users,
      show: isAdmin,
      active: path.startsWith('/admin-console'),
      sub: [
        { label: 'Members', to: '/admin-console/members', active: path.startsWith('/admin-console/members') },
        ...(isAdmin
          ? [{ label: 'Domains', to: '/admin-console/domains', active: path.startsWith('/admin-console/domains') }]
          : []),
      ],
    },
  ].filter((s) => s.show)

  const activeSection = sections.find((s) => s.active)
  const initials = userInitials(user)

  return (
    <div className="min-h-screen bg-section-bg flex flex-col">
      {/* Top bar — dark DALI header */}
      <div className="bg-[hsl(203,38%,23%)] dark:bg-[hsl(215,35%,10%)] sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              className="md:hidden p-1.5 -ml-1.5 text-white/70 hover:text-white"
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav-panel"
              onClick={() => setMobileNavOpen((v) => !v)}
            >
              {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-base leading-none font-heading">D</span>
            </div>
            <span className="font-heading font-bold text-lg text-white tracking-tight truncate">DALI Hiring</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/50 hidden sm:block truncate max-w-[200px]">{user.email}</span>
            <div className="w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
              {initials}
            </div>
            <a href="/logout" className="text-white/40 hover:text-white/70 transition" title="Log out">
              <LogOut className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Desktop navigation bar — primary tabs + sub-tabs inline */}
      <div className="hidden md:block bg-card border-b border-border sticky top-14 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6 h-11">
            {/* Primary tabs */}
            <nav className="flex items-center gap-1 -mb-px h-full">
              {sections.map((section) => (
                <Link
                  key={section.to}
                  to={section.to}
                  className={`inline-flex items-center gap-1.5 px-3 h-full border-b-2 text-sm font-heading font-semibold transition-colors whitespace-nowrap ${
                    section.active
                      ? 'border-accent-coral text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
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
                <div className="w-px h-5 bg-border" />
                <nav className="flex items-center gap-0.5">
                  {activeSection.sub.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
                        item.active
                          ? 'bg-accent-coral/10 text-accent-coral'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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

      {/* Mobile section breadcrumb — visible below header on small screens */}
      {activeSection && (
        <div className="md:hidden bg-card border-b border-border sticky top-14 z-10">
          <div className="px-4 h-11 flex items-center gap-2 text-sm font-heading font-semibold text-foreground">
            <activeSection.icon className="w-4 h-4 text-accent-coral" />
            <span>{activeSection.label}</span>
            {activeSection.sub && (
              <nav className="flex items-center gap-0.5 ml-auto overflow-x-auto">
                {activeSection.sub.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`px-2 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap ${
                      item.active
                        ? 'bg-accent-coral/10 text-accent-coral'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
        </div>
      )}

      {/* Mobile nav panel — slide-down list */}
      {mobileNavOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 top-14 z-10 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-panel"
            className="md:hidden fixed inset-x-0 top-14 z-20 bg-card border-b border-border shadow-lg max-h-[calc(100vh-3.5rem)] overflow-y-auto"
          >
            <nav className="py-2">
              {sections.map((section) => (
                <div key={section.to} className="border-b border-border last:border-b-0">
                  <Link
                    to={section.to}
                    className={`flex items-center gap-3 px-4 py-3 text-sm font-heading font-semibold ${
                      section.active
                        ? 'bg-accent-coral/5 text-accent-coral'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <section.icon className="w-4 h-4" />
                    {section.label}
                  </Link>
                  {section.sub && section.active && (
                    <div className="bg-muted/30">
                      {section.sub.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={`flex items-center gap-3 pl-12 pr-4 py-2.5 text-xs font-medium ${
                            item.active
                              ? 'text-accent-coral'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>
        </>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        {children}
      </main>
    </div>
  )
}
