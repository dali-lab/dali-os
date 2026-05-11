import React, { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router'
import {
  LogOut,
  Users,
  Calendar,
  Shield,
  Mail,
  FileText,
  MessageSquare,
  Menu,
  X,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Briefcase,
  Settings,
  FolderKanban,
  UsersRound,
  Handshake,
  List,
  UserPlus,
  Building2,
} from 'lucide-react'
import { userInitials } from '~/lib/display'
import { TabWorkspace, type TabWorkspaceHandle, type OpenTabRequest } from '~/components/TabWorkspace'

interface LayoutProps {
  children: React.ReactNode
  user: { email: string; firstName?: string; lastName?: string }
  isHiringLead?: boolean
  isAdmin?: boolean
  isDomainLead?: boolean
  isInterviewer?: boolean
}

const SIDEBAR_COLLAPSED_KEY = 'dali:sidebar:collapsed'
const EXPANDED_AREAS_KEY = 'dali:sidebar:expanded-areas'

type AreaKey = 'hiring' | 'projects' | 'members' | 'partners' | 'admin-console'

export function Layout({ children, user, isHiringLead = false, isAdmin = false, isDomainLead = false, isInterviewer = false }: LayoutProps) {
  const location = useLocation()
  const path = location.pathname
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [userExpanded, setUserExpanded] = useState<Record<AreaKey, boolean | undefined>>({
    hiring: undefined,
    projects: undefined,
    members: undefined,
    partners: undefined,
    'admin-console': undefined,
  })
  const workspaceRef = useRef<TabWorkspaceHandle | null>(null)

  const openInWorkspace = (req: OpenTabRequest) => {
    workspaceRef.current?.openTab(req)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
    try {
      const raw = window.localStorage.getItem(EXPANDED_AREAS_KEY)
      if (raw) setUserExpanded(JSON.parse(raw))
    } catch {
      // ignore — bad JSON just means we use defaults
    }
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [path])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      if (typeof window !== 'undefined') {
        if (next) window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
        else window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
      }
      return next
    })
  }

  const toggleAreaExpanded = (key: AreaKey, defaultExpanded: boolean) => {
    setUserExpanded((prev) => {
      const current = prev[key] ?? defaultExpanded
      const next = { ...prev, [key]: !current }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(EXPANDED_AREAS_KEY, JSON.stringify(next))
      }
      return next
    })
  }

  const activeAreaKey: AreaKey | null =
    path.startsWith('/admin-console') ? 'admin-console'
    : path.startsWith('/hiring') ? 'hiring'
    : path.startsWith('/projects') ? 'projects'
    : path.startsWith('/members') ? 'members'
    : path.startsWith('/partners') ? 'partners'
    : null

  const hiringSections = [
    {
      label: 'Domain',
      to: '/hiring/domain-lead',
      icon: Shield,
      show: isDomainLead,
      active: path.startsWith('/hiring/domain-lead'),
      sub: null as { label: string; to: string; active: boolean }[] | null,
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
      label: 'Analytics',
      to: '/hiring/analytics',
      icon: BarChart3,
      show: isHiringLead || isDomainLead,
      active: path.startsWith('/hiring/analytics'),
      sub: null,
    },
    {
      label: 'Challenges',
      to: '/hiring/challenges',
      icon: FileText,
      show: isHiringLead || isDomainLead || isAdmin,
      active: path.startsWith('/hiring/challenges'),
      sub: null,
    },
    {
      label: 'Rubrics',
      to: '/hiring/rubrics',
      icon: FileText,
      show: isHiringLead || isDomainLead || isAdmin,
      active: path.startsWith('/hiring/rubrics'),
      sub: null,
    },
    {
      label: 'Agreements',
      to: '/hiring/confidentiality-agreements',
      icon: FileText,
      show: isHiringLead || isDomainLead || isAdmin,
      active: path.startsWith('/hiring/confidentiality-agreements'),
      sub: null,
    },
    {
      label: 'Emails',
      to: '/hiring/emails',
      icon: Mail,
      show: isHiringLead,
      active: path.startsWith('/hiring/emails'),
      sub: null,
    },
  ].filter((s) => s.show)

  const adminSections = [
    {
      label: 'Members',
      to: '/admin-console/members',
      icon: Users,
      show: true,
      active: path.startsWith('/admin-console/members'),
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
    {
      label: 'Domains',
      to: '/admin-console/domains',
      icon: Shield,
      show: isAdmin,
      active: path.startsWith('/admin-console/domains'),
      sub: null,
    },
  ].filter((s) => s.show)

  const projectsSections = [
    {
      label: 'List',
      to: '/projects/list',
      icon: List,
      show: true,
      active: path.startsWith('/projects/list'),
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
    {
      label: 'Staffing',
      to: '/projects/staffing',
      icon: UserPlus,
      show: true,
      active: path.startsWith('/projects/staffing'),
      sub: null,
    },
  ].filter((s) => s.show)

  const membersSections = [
    {
      label: 'Directory',
      to: '/members',
      icon: UsersRound,
      show: true,
      active: path === '/members' || path.startsWith('/members/'),
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
  ].filter((s) => s.show)

  const partnersSections = [
    {
      label: 'Organizations',
      to: '/partners',
      icon: Building2,
      show: true,
      active: path === '/partners' || path.startsWith('/partners/'),
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
  ].filter((s) => s.show)

  const hasHiringAccess = true
  const areas = [
    {
      key: 'hiring' as AreaKey,
      label: 'Hiring',
      to: '/hiring/reviewer',
      icon: Briefcase,
      show: hasHiringAccess,
      active: activeAreaKey === 'hiring',
      sections: hiringSections,
    },
    {
      key: 'projects' as AreaKey,
      label: 'Projects',
      to: '/projects/list',
      icon: FolderKanban,
      show: true,
      active: activeAreaKey === 'projects',
      sections: projectsSections,
    },
    {
      key: 'members' as AreaKey,
      label: 'Members',
      to: '/members',
      icon: UsersRound,
      show: true,
      active: activeAreaKey === 'members',
      sections: membersSections,
    },
    {
      key: 'partners' as AreaKey,
      label: 'Partners',
      to: '/partners',
      icon: Handshake,
      show: true,
      active: activeAreaKey === 'partners',
      sections: partnersSections,
    },
    {
      key: 'admin-console' as AreaKey,
      label: 'Admin Console',
      to: '/admin-console',
      icon: Settings,
      show: isAdmin,
      active: activeAreaKey === 'admin-console',
      sections: adminSections,
    },
  ].filter((a) => a.show)

  const activeArea = areas.find((a) => a.active)
  const activeSection = activeArea?.sections.find((s) => s.active)

  const initials = userInitials(user)
  const sidebarWidth = collapsed ? 'w-16' : 'w-64'

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className={`h-14 flex items-center flex-shrink-0 ${collapsed ? 'justify-center px-2' : 'justify-between px-3 gap-2'}`}>
        <Link to="/" className="flex items-center gap-2.5 min-w-0 focus:outline-none" title="DALI">
          <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-base leading-none font-heading">D</span>
          </div>
          {!collapsed && (
            <span className="font-heading font-bold text-lg text-white tracking-tight truncate">
              <span className="text-accent-coral/80">D</span>
              <sup className="text-accent-coral/80 text-[0.5em]">3</sup>ALI OS
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden md:flex p-1.5 text-white/40 hover:text-white/80 hover:bg-white/5 rounded-md transition flex-shrink-0"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden md:flex mx-2 mt-2 p-1.5 items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/5 rounded-md transition"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Areas + nested sections */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {areas.map((area) => {
          // Default: active area is expanded, inactive is collapsed. User toggle overrides.
          const expanded = userExpanded[area.key] ?? area.active
          const showSections = !collapsed && expanded && area.sections.length > 0
          return (
            <div key={area.key} className="flex flex-col">
              {/* Area row — chevron toggles expand; label/icon navigates */}
              <div
                className={`flex items-stretch rounded-md hover:bg-white/5 ${collapsed ? 'justify-center' : ''}`}
              >
                <button
                  type="button"
                  title={collapsed ? area.label : undefined}
                  aria-expanded={expanded}
                  onClick={() => toggleAreaExpanded(area.key, area.active)}
                  className={`flex-1 flex items-center gap-3 ${collapsed ? 'px-3 py-2 justify-center' : 'pl-3 pr-1 py-2'} text-sm font-heading font-semibold text-left transition-colors ${
                    area.active ? 'text-white' : 'text-white/65 hover:text-white'
                  }`}
                >
                  <area.icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span className="truncate">{area.label}</span>}
                </button>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleAreaExpanded(area.key, area.active)}
                    aria-label={expanded ? `Collapse ${area.label}` : `Expand ${area.label}`}
                    aria-expanded={expanded}
                    className="flex items-center justify-center w-7 text-white/40 hover:text-white/80 transition flex-shrink-0"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
                    />
                  </button>
                )}
              </div>

              {/* Nested sections */}
              {showSections && (
                <div className="mt-1 mb-1 ml-4 pl-2 border-l border-white/10 flex flex-col gap-0.5">
                  {area.sections.map((section) => (
                    <button
                      key={section.to}
                      type="button"
                      onClick={() => openInWorkspace({ url: section.to, label: section.label })}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-left transition-colors ${
                        section.active
                          ? 'bg-accent-coral/20 text-white'
                          : 'text-white/55 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <section.icon className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{section.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer — user + logout */}
      <div className="border-t border-white/10 p-2 flex-shrink-0">
        <div className={`flex items-center gap-2 px-2 py-2 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white/80 truncate">{user.email}</div>
            </div>
          )}
          {!collapsed && (
            <a
              href="/logout"
              className="text-white/40 hover:text-white/70 transition flex-shrink-0"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-section-bg flex">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col fixed inset-y-0 left-0 z-20 ${sidebarWidth} bg-[hsl(203,38%,23%)] dark:bg-[hsl(215,35%,10%)] transition-[width] duration-200`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed inset-x-0 top-0 z-20 h-14 bg-[hsl(203,38%,23%)] dark:bg-[hsl(215,35%,10%)] flex items-center justify-between px-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="p-1.5 -ml-1.5 text-white/70 hover:text-white"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-nav-panel"
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-accent-coral rounded-md flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-base leading-none font-heading">D</span>
            </div>
            <span className="font-heading font-bold text-lg text-white tracking-tight">
              <span className="text-accent-coral/80">D</span>
              <sup className="text-accent-coral/80 text-[0.5em]">3</sup>ALI OS
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs">
            {initials}
          </div>
          <a href="/logout" className="text-white/40 hover:text-white/70 transition" title="Log out">
            <LogOut className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-30 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside
            id="mobile-nav-panel"
            className="md:hidden fixed inset-y-0 left-0 z-40 w-64 bg-[hsl(203,38%,23%)] dark:bg-[hsl(215,35%,10%)] flex flex-col shadow-xl"
          >
            {sidebarContent}
          </aside>
        </>
      )}

      <main className={`flex-1 min-w-0 flex flex-col ${collapsed ? 'md:pl-16' : 'md:pl-64'} pt-14 md:pt-0 transition-[padding] duration-200`}>
        {activeAreaKey ? (
          // Inside an area — use the tabbed workspace
          <TabWorkspace
            apiRef={workspaceRef}
            initialTabs={activeSection ? [{ url: activeSection.to, label: activeSection.label }] : []}
          />
        ) : (
          // Outside areas (home, etc.) — render the route directly
          <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 lg:px-12 py-6 md:py-8">
            {children}
          </div>
        )}
      </main>
    </div>
  )
}
