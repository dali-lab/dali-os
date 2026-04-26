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
  FileText,
  MessageSquare,
  X,
} from 'lucide-react'
import { bumpLogoClick, hydrateRetroClass } from '~/lib/party'

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
  const [showStats, setShowStats] = React.useState(false)

  const handleLogoClick = () => {
    bumpLogoClick()
  }

  React.useEffect(() => {
    hydrateRetroClass()
    // Boot banner — only fires once per page load
    const banner = [
      '%c',
      '    ██████╗  █████╗ ██╗     ██╗',
      '    ██╔══██╗██╔══██╗██║     ██║',
      '    ██║  ██║███████║██║     ██║',
      '    ██║  ██║██╔══██║██║     ██║',
      '    ██████╔╝██║  ██║███████╗██║',
      '    ╚═════╝ ╚═╝  ╚═╝╚══════╝╚═╝',
      '',
      '    Welcome, friend. Have you tried spamming our logo? It\'s weirdly satisfying.',
      '',
    ].join('\n')
    console.log(banner, 'color: hsl(354 70% 61%); font-family: monospace; line-height: 1;')

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        setShowStats(s => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      show: isAdmin || isHiringLead,
      active: path.startsWith('/admin-console'),
      sub: null,
    },
  ].filter((s) => s.show)

  const activeSection = sections.find((s) => s.active)
  const initials = user.email.slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-section-bg flex flex-col">
      {/* Top bar — dark DALI header */}
      <div className="bg-[hsl(203,38%,23%)] dark:bg-[hsl(215,35%,10%)] sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <button
            type="button"
            onClick={handleLogoClick}
            className="flex items-center gap-2.5 focus:outline-none"
            title="DALI"
          >
            <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-base leading-none font-heading">D</span>
            </div>
            <span className="font-heading font-bold text-lg text-white tracking-tight">DALI Hiring</span>
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/50 hidden sm:block">{user.email}</span>
            <div className="w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs">
              {initials}
            </div>
            <a href="/logout" className="text-white/40 hover:text-white/70 transition" title="Log out">
              <LogOut className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      {/* Navigation bar — primary tabs + sub-tabs inline */}
      <div className="bg-card border-b border-border sticky top-14 z-10">
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

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {showStats && <StatsModal onClose={() => setShowStats(false)} />}
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
        <h2 className="font-heading text-xl font-bold text-foreground mb-1">DALI Hiring · Stats</h2>
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
