import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import {
  LayoutDashboard,
  Trophy,
  ClipboardList,
  LogOut,
  Users,
  UserCircle,
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
import { bumpLogoClick, hydrateRetroClass, logConsoleBootBanner } from '~/lib/party'
import { RetroExitPill } from '~/components/RetroExitPill'

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
  const [showStats, setShowStats] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const handleLogoClick = () => {
    bumpLogoClick()
  }

  useEffect(() => {
    hydrateRetroClass()
    logConsoleBootBanner()

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        setShowStats(s => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [path])

  // Tier 1 — top-level sections (always shown).
  const hasHiringAccess = true // every authenticated, non-applicant user can use hiring views
  const areas = [
    {
      key: 'hiring' as const,
      label: 'Hiring',
      to: '/hiring/reviewer',
      show: hasHiringAccess,
      active: path.startsWith('/hiring'),
    },
    {
      key: 'admin-console' as const,
      label: 'Admin Console',
      to: '/admin-console',
      show: isAdmin,
      active: path.startsWith('/admin-console'),
    },
  ]
  const activeAreaKey: 'hiring' | 'admin-console' | null =
    path.startsWith('/admin-console') ? 'admin-console'
    : path.startsWith('/hiring') ? 'hiring'
    : null

  // Tier 2 — section nav, depends on active area.
  const hiringSections = [
    {
      label: 'Domain',
      to: '/hiring/domain-lead',
      icon: Shield,
      show: isDomainLead,
      active: path.startsWith('/hiring/domain-lead'),
      sub: null,
    },
    {
      label: 'Reviews',
      to: '/hiring/reviewer',
      icon: MessageSquare,
      show: true,
      active: path.startsWith('/hiring/reviewer') || path.startsWith('/hiring/interviewer'),
      sub: null,
    },
    {
      label: 'Cycles',
      to: '/hiring/lead',
      icon: Calendar,
      show: isHiringLead,
      active: path.startsWith('/hiring/lead'),
      sub: null,
    },
    {
      label: 'Library',
      to: '/hiring/challenges',
      icon: FileText,
      show: isHiringLead || isDomainLead || isAdmin,
      active:
        path.startsWith('/hiring/challenges') ||
        path.startsWith('/hiring/rubrics') ||
        path.startsWith('/hiring/confidentiality-agreements'),
      sub: [
        { label: 'Challenges', to: '/hiring/challenges', active: path.startsWith('/hiring/challenges') },
        { label: 'Rubrics', to: '/hiring/rubrics', active: path.startsWith('/hiring/rubrics') },
        { label: 'Confidentiality Agreements', to: '/hiring/confidentiality-agreements', active: path.startsWith('/hiring/confidentiality-agreements') },
      ],
    },
    {
      label: 'Emails',
      to: '/hiring/emails',
      icon: Mail,
      show: isHiringLead,
      active: path.startsWith('/hiring/emails'),
    },
  ]

  const adminSections = [
    {
      label: 'Members',
      to: '/admin-console/members',
      icon: Users,
      show: true,
      active: path.startsWith('/admin-console/members'),
      sub: null,
    },
    {
      label: 'Accounts',
      to: '/admin-console/accounts',
      icon: UserCircle,
      show: isAdmin,
      active: path.startsWith('/admin-console/accounts'),
      sub: null,
    },
    {
      label: 'Domains',
      to: '/admin-console/domains',
      icon: Shield,
      show: isAdmin,
      active: path.startsWith('/admin-console/domains'),
      sub: null,
    },
    {
      label: 'Party',
      to: '/admin-console/party',
      icon: Trophy,
      show: isAdmin,
      active: path.startsWith('/admin-console/party'),
      sub: null,
    },
  ]

  const sections = (
    activeAreaKey === 'admin-console' ? adminSections
    : activeAreaKey === 'hiring' ? hiringSections
    : hiringSections
  ).filter((s) => s.show)

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
            <button
              type="button"
              onClick={handleLogoClick}
              className="flex items-center gap-2.5 focus:outline-none min-w-0"
              title="DALI"
            >
              <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-base leading-none font-heading">D</span>
              </div>
              <span className="font-heading font-bold text-lg text-white tracking-tight truncate">
                <span className="text-accent-coral/80">D</span>
                <sup className="text-accent-coral/80 text-[0.5em]">3</sup>ALI OS
              </span>
            </button>

            {/* Tier 1 — section switcher, inline with brand on desktop */}
            <nav className="hidden md:flex items-center gap-0.5 ml-4 pl-4 border-l border-white/10">
              {areas.map((area) => (
                <Link
                  key={area.key}
                  to={area.to}
                  aria-disabled={!area.show}
                  tabIndex={area.show ? 0 : -1}
                  className={`px-2.5 py-1 text-xs font-heading font-semibold rounded-md transition-colors whitespace-nowrap ${
                    area.active
                      ? 'bg-white/15 text-white'
                      : area.show
                        ? 'text-white/60 hover:text-white hover:bg-white/5'
                        : 'text-white/25 cursor-not-allowed'
                  }`}
                  onClick={(e) => { if (!area.show) e.preventDefault() }}
                >
                  {area.label}
                </Link>
              ))}
            </nav>
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
            {/* Tier 1 — section switcher (always shown) */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-muted/30">
              {areas.map((area) => (
                <Link
                  key={area.key}
                  to={area.to}
                  aria-disabled={!area.show}
                  tabIndex={area.show ? 0 : -1}
                  onClick={(e) => { if (!area.show) e.preventDefault() }}
                  className={`px-2.5 py-1 text-xs font-heading font-semibold rounded-md transition-colors ${
                    area.active
                      ? 'bg-accent-coral/10 text-accent-coral'
                      : area.show
                        ? 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        : 'text-muted-foreground/40 cursor-not-allowed'
                  }`}
                >
                  {area.label}
                </Link>
              ))}
            </div>
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

      {showStats && <StatsModal onClose={() => setShowStats(false)} />}
      <RetroExitPill />
    </div>
  )
}

function StatsModal({ onClose }: { onClose: () => void }) {
  const stats: [string, string][] = [
    ['Cycles run', '7'],
    ['Applications reviewed', '1,284'],
    ['Challenges written', '42'],
    ['Interviews scheduled', '318'],
    ['Lines of code', '~48k'],
    ['Coffees consumed', '∞'],
    ['Launch year', '2026'],
  ]
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-md p-6 relative"
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <h2 className="font-heading text-xl font-bold text-foreground mb-1">DALI OS · Stats</h2>
        <p className="text-xs text-muted-foreground mb-4">A little snapshot of the party we've been throwing.</p>
        <dl className="divide-y divide-border">
          {stats.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-2">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-mono font-semibold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[10px] uppercase tracking-wider text-muted-foreground/70">⌘⇧D to toggle</p>
      </div>
    </div>
  )
}
