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
  Home,
  List,
  UserPlus,
  Building2,
  Workflow,
  ArrowRightLeft,
  TrendingUp,
  Rocket,
  ClipboardList,
  GraduationCap,
  ListTodo,
  Megaphone,
} from 'lucide-react'
import { userInitials } from '~/lib/display'
import { TabWorkspace, type TabWorkspaceHandle, type OpenTabRequest } from '~/components/TabWorkspace'
import { useUnreadNotificationCount, useOpenTasks, UnreadBadge } from '~/components/NotificationBell'

interface LayoutProps {
  user: { email: string; firstName?: string; lastName?: string }
  isHiringLead?: boolean
  isAdmin?: boolean
  isDomainLead?: boolean
  canViewForms?: boolean
  canViewStaffing?: boolean
  isInterviewer?: boolean
}

const SIDEBAR_COLLAPSED_KEY = 'dali:sidebar:collapsed'
const EXPANDED_AREAS_KEY = 'dali:sidebar:expanded-areas'

type AreaKey = 'hiring' | 'projects' | 'members' | 'partners' | 'education' | 'internal-processes' | 'admin-console'

export function Layout({ user, isHiringLead = false, isAdmin = false, isDomainLead = false, canViewForms = false, canViewStaffing = false, isInterviewer = false }: LayoutProps) {
  const location = useLocation()
  const [focusedTabUrl, setFocusedTabUrl] = useState<string | null>(null)
  // Sidebar highlight follows the focused workspace tab when one is open;
  // otherwise it falls back to the parent route.
  const path = focusedTabUrl ?? location.pathname
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [userExpanded, setUserExpanded] = useState<Record<AreaKey, boolean | undefined>>({
    hiring: undefined,
    projects: undefined,
    members: undefined,
    partners: undefined,
    education: undefined,
    'internal-processes': undefined,
    'admin-console': undefined,
  })
  // Last subtab URL the user was on within each area. Updated whenever the
  // focused workspace tab points into an area. Used so re-clicking the parent
  // after closing/leaving the area reopens the subtab you were last on,
  // instead of jumping to the first subtab.
  const [lastSubtabUrl, setLastSubtabUrl] = useState<Record<AreaKey, string | undefined>>({
    hiring: undefined,
    projects: undefined,
    members: undefined,
    partners: undefined,
    education: undefined,
    'internal-processes': undefined,
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

  // Remember the last subtab URL inside each area. The area key is derived
  // from the path prefix so this stays in lockstep with activeAreaKey below.
  useEffect(() => {
    const areaKey: AreaKey | null =
      path.startsWith('/admin-console') ? 'admin-console'
      : path.startsWith('/hiring') ? 'hiring'
      : path.startsWith('/projects') ? 'projects'
      : path.startsWith('/members') ? 'members'
      : path.startsWith('/partners') ? 'partners'
      : path.startsWith('/education') ? 'education'
      : path.startsWith('/internal-processes') ? 'internal-processes'
      : null
    if (!areaKey) return
    setLastSubtabUrl((prev) =>
      prev[areaKey] === path ? prev : { ...prev, [areaKey]: path },
    )
  }, [path])

  // Listen for "open in new tab" requests from embedded iframes (e.g. a
  // notification card in the Home tab whose link would otherwise navigate
  // the iframe itself, trapping the user in chrome-less embed mode).
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data
      if (!data) return
      if (data.type === 'dali:openTab' && typeof data.url === 'string') {
        workspaceRef.current?.openTab({ url: data.url, label: data.label || data.url })
      } else if (
        data.type === 'dali:setTabLabel' &&
        typeof data.url === 'string' &&
        typeof data.label === 'string'
      ) {
        workspaceRef.current?.setTabLabel(data.url, data.label)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

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

  // Force-expand without toggling. Used when clicking a parent label so the
  // sidebar reveals the parent's subtabs alongside the navigation, rather
  // than collapsing them off-screen if the user had previously closed the
  // group.
  const setAreaExpanded = (key: AreaKey) => {
    setUserExpanded((prev) => {
      if (prev[key] === true) return prev
      const next = { ...prev, [key]: true }
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
    : path.startsWith('/education') ? 'education'
    : path.startsWith('/internal-processes') ? 'internal-processes'
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
      active: path.startsWith('/hiring/reviewer') || path.startsWith('/hiring/interviewer/interview'),
      sub: null,
    },
    {
      // Database view of all submissions for a cycle. Core sees every
      // domain; reviewers see only their assigned domains. The route
      // itself handles users with no access (empty state), so the tab is
      // shown to everyone like Reviews.
      label: 'Applications',
      to: '/hiring/applications',
      icon: FileText,
      show: true,
      active: path.startsWith('/hiring/applications'),
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
      label: 'Library',
      to: '/hiring/library',
      icon: FileText,
      show: isHiringLead || isDomainLead || isAdmin,
      // Highlight Library on its list page and on the challenge / rubric /
      // agreement detail pages it links into.
      active:
        path.startsWith('/hiring/library') ||
        path.startsWith('/hiring/challenges') ||
        path.startsWith('/hiring/rubrics') ||
        path.startsWith('/hiring/confidentiality-agreements'),
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
    {
      label: 'Announcements',
      to: '/admin-console/announcements',
      icon: Megaphone,
      show: isAdmin,
      active: path.startsWith('/admin-console/announcements'),
      sub: null,
    },
  ].filter((s) => s.show)

  const projectsSections = [
    {
      label: 'Hub',
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
      show: canViewStaffing,
      active: path.startsWith('/projects/staffing'),
      sub: null,
    },
    {
      label: 'Intent to Work',
      to: '/projects/intent-to-work',
      icon: FileText,
      show: canViewStaffing,
      active: path.startsWith('/projects/intent-to-work'),
      sub: null,
    },
    {
      label: 'Project Bids',
      to: '/projects/project-bids',
      icon: ClipboardList,
      show: canViewStaffing,
      active: path.startsWith('/projects/project-bids'),
      sub: null,
    },
  ].filter((s) => s.show)

  const membersSections = [
    {
      label: 'Database',
      to: '/members',
      icon: UsersRound,
      show: true,
      active: path === '/members',
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
    {
      label: 'Groups',
      to: '/members/groups',
      icon: Users,
      show: canViewForms,
      active: path.startsWith('/members/groups'),
      sub: null,
    },
  ].filter((s) => s.show)

  const partnersSections = [
    {
      label: 'Organizations',
      to: '/partners',
      icon: Building2,
      show: true,
      active: path === '/partners',
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
    {
      label: 'Applications',
      to: '/partners/applications',
      icon: ClipboardList,
      show: canViewStaffing,
      active: path.startsWith('/partners/applications'),
      sub: null,
    },
  ].filter((s) => s.show)

  const educationSections = [
    {
      label: 'Overview',
      to: '/education',
      icon: GraduationCap,
      show: true,
      active: path === '/education' || path.startsWith('/education/'),
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
  ].filter((s) => s.show)

  const internalProcessesSections = [
    {
      label: 'Transfer',
      to: '/internal-processes/transfer',
      icon: ArrowRightLeft,
      show: true,
      active: path.startsWith('/internal-processes/transfer'),
      sub: null as { label: string; to: string; active: boolean }[] | null,
    },
    {
      label: 'Level Up',
      to: '/internal-processes/level-up',
      icon: TrendingUp,
      show: true,
      active: path.startsWith('/internal-processes/level-up'),
      sub: null,
    },
    {
      label: 'JobX',
      to: '/internal-processes/jobx',
      icon: Rocket,
      show: true,
      active: path.startsWith('/internal-processes/jobx'),
      sub: null,
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
      key: 'education' as AreaKey,
      label: 'Education',
      to: '/education',
      icon: GraduationCap,
      show: true,
      active: activeAreaKey === 'education',
      sections: educationSections,
    },
    {
      key: 'internal-processes' as AreaKey,
      label: 'Internal Processes',
      to: '/internal-processes/transfer',
      icon: Workflow,
      show: true,
      active: activeAreaKey === 'internal-processes',
      sections: internalProcessesSections,
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
  const unreadCount = useUnreadNotificationCount()
  const openTasks = useOpenTasks()
  const taskCount = openTasks.length
  const sidebarWidth = collapsed ? 'w-16' : 'w-64'

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className={`h-14 flex items-center flex-shrink-0 ${collapsed ? 'justify-center px-2' : 'justify-between px-3 gap-2'}`}>
        <button
          type="button"
          onClick={() => openInWorkspace({ url: '/', label: 'Home' })}
          className="flex items-center gap-2.5 min-w-0 focus:outline-none"
          title="Home"
        >
          {/* #566 brand logo, kept on the workspace-tab nav (not a <Link>) */}
          <img
            src="/icon-white.svg"
            alt=""
            aria-hidden="true"
            className="w-8 h-8 flex-shrink-0"
          />
          {!collapsed && (
            <span className="font-heading font-bold text-lg text-white tracking-tight truncate">
              DALI OS
            </span>
          )}
        </button>
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
        {(() => {
          const hasTasks = taskCount > 0
          const homeActive = path === '/'
          // Tasks has no page of its own. With no todos it's an inert label.
          // With todos the header navigates to Home (the task overview) and
          // sits above one subtab per todo, each linking to its own target.
          const headerInner = (
            <>
              <span className="relative flex-shrink-0">
                <ListTodo className="w-4 h-4" />
                {/* Collapsed: a dot is the only room we have to signal pending work. */}
                {collapsed && hasTasks && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent-coral" />
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="truncate">Tasks</span>
                  <span
                    className={`ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold ${
                      hasTasks
                        ? 'bg-accent-coral text-white'
                        : 'bg-white/10 text-white/50'
                    }`}
                    aria-label={`${taskCount} open task${taskCount === 1 ? '' : 's'}`}
                  >
                    {taskCount > 99 ? '99+' : taskCount}
                  </span>
                </>
              )}
            </>
          )
          // dev (#566 era) added an explicit Home nav button; HEAD added the
          // Tasks section (Tasks-nav feature). Keep both: Home on top, then
          // the Tasks header + per-todo subtabs.
          return (
            <>
              <button
                type="button"
                title={collapsed ? 'Home' : undefined}
                onClick={() => openInWorkspace({ url: '/', label: 'Home' })}
                className={`flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
                  homeActive ? 'text-white' : 'text-white/65 hover:text-white'
                }`}
              >
                <Home className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="truncate">Home</span>}
              </button>
              <div className="flex flex-col">
                {hasTasks ? (
                  <button
                    type="button"
                    title={collapsed ? `Tasks (${taskCount})` : undefined}
                    onClick={() => openInWorkspace({ url: '/', label: 'Home' })}
                    className={`relative flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left text-white transition-colors hover:bg-white/5`}
                  >
                    {headerInner}
                  </button>
                ) : (
                  <div
                    title={collapsed ? 'Tasks (0)' : undefined}
                    className={`relative flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-white/40`}
                  >
                    {headerInner}
                  </div>
                )}

                {!collapsed && hasTasks && (
                  <div className="mt-1 mb-1 ml-4 pl-2 border-l border-white/10 flex flex-col gap-0.5">
                    {openTasks.map((t) => {
                      const cls =
                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-left transition-colors'
                      return t.link ? (
                        <button
                          key={t.id}
                          type="button"
                          title={t.title}
                          onClick={() => {
                            // Tasks are notification rows — POST /read clears
                            // the tile + drops the count once the user acts.
                            fetch(`/api/notifications/${t.id}/read`, {
                              method: 'POST',
                              credentials: 'include',
                              keepalive: true,
                            })
                            openInWorkspace({ url: t.link!, label: t.title })
                          }}
                          className={`${cls} text-white/55 hover:text-white hover:bg-white/5`}
                        >
                          <span className="truncate">{t.title}</span>
                        </button>
                      ) : (
                        <div
                          key={t.id}
                          title={t.title}
                          className={`${cls} text-white/40`}
                        >
                          <span className="truncate">{t.title}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )
        })()}
        {(() => {
          const calendarActive = path.startsWith('/calendar')
          return (
            <button
              type="button"
              title={collapsed ? 'Calendar' : undefined}
              onClick={() => openInWorkspace({ url: '/calendar', label: 'Calendar' })}
              className={`flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
                calendarActive ? 'text-white' : 'text-white/65 hover:text-white'
              }`}
            >
              <Calendar className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">Calendar</span>}
            </button>
          )
        })()}
        {canViewForms && (() => {
          const formsActive = path.startsWith('/forms')
          return (
            <button
              type="button"
              title={collapsed ? 'Forms' : undefined}
              onClick={() => openInWorkspace({ url: '/forms', label: 'Forms' })}
              className={`flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
                formsActive ? 'text-white' : 'text-white/65 hover:text-white'
              }`}
            >
              <ClipboardList className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">Forms</span>}
            </button>
          )
        })()}
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
                  onClick={() => {
                    // Clicking the parent label:
                    //   - if you're already on this area AND its subtabs are
                    //     open, collapse them (re-click to close);
                    //   - otherwise, expand the group and navigate. Prefer
                    //     (1) the currently-active subtab, then (2) the last
                    //     subtab the user visited inside this area (so
                    //     reopening after closing the tab returns you there),
                    //     and fall back to the first subtab / area.to.
                    // The chevron beside this button is still a pure toggle.
                    if (area.active && expanded && area.sections.length > 0) {
                      toggleAreaExpanded(area.key, area.active)
                      return
                    }
                    setAreaExpanded(area.key)
                    const activeSection = area.sections.find((s) => s.active)
                    const remembered = lastSubtabUrl[area.key]
                    const rememberedSection = remembered
                      ? area.sections.find((s) => s.to === remembered)
                      : undefined
                    const target =
                      activeSection?.to ?? remembered ?? area.sections[0]?.to ?? area.to
                    const label =
                      activeSection?.label ??
                      rememberedSection?.label ??
                      area.sections[0]?.label ??
                      area.label
                    openInWorkspace({ url: target, label })
                  }}
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
        <div className={`flex items-center gap-1 px-1 py-1 ${collapsed ? 'justify-center' : ''}`}>
          <button
            type="button"
            onClick={() => openInWorkspace({ url: '/profile', label: 'Profile' })}
            title={collapsed ? `Open profile${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}` : undefined}
            aria-label="Open profile"
            className={`flex items-center gap-2 rounded-md hover:bg-white/5 transition-colors ${
              collapsed ? 'p-1.5' : 'flex-1 min-w-0 px-2 py-1.5 text-left'
            }`}
          >
            <div className="relative w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs flex-shrink-0">
              {initials}
              <UnreadBadge count={unreadCount} />
            </div>
            {!collapsed && (
              <span className="text-xs text-white/80 truncate min-w-0">{user.email}</span>
            )}
          </button>
          {!collapsed && (
            <a
              href="/logout"
              className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 rounded-md transition flex-shrink-0"
              title="Log out"
              aria-label="Log out"
            >
              <LogOut className="w-4 h-4" />
            </a>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className="min-h-screen min-h-dvh bg-page flex flex-col md:flex-row pt-14 md:pt-0">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col fixed inset-y-0 left-0 z-20 ${sidebarWidth} bg-sidebar-bg transition-[width] duration-200`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed inset-x-0 top-0 z-20 h-14 bg-sidebar-bg flex items-center justify-between px-3">
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
          <button
            type="button"
            onClick={() => openInWorkspace({ url: '/', label: 'Home' })}
            className="flex items-center gap-2.5"
            title="Home"
          >
            {/* #566 brand logo, kept on the workspace-tab nav (not a <Link>) */}
            <img
              src="/icon-white.svg"
              alt=""
              aria-hidden="true"
              className="w-8 h-8 flex-shrink-0"
            />
            <span className="font-heading font-bold text-lg text-white tracking-tight">
              DALI OS
            </span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/profile"
            aria-label={unreadCount > 0 ? `Profile (${unreadCount} unread)` : 'Profile'}
            className="relative w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs"
          >
            {initials}
            <UnreadBadge count={unreadCount} />
          </Link>
          <a href="/logout" className="text-white/40 hover:text-white/70 transition" title="Log out">
            <LogOut className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Mobile section breadcrumb — visible below header on small screens */}
      {activeSection && (
        <div className="md:hidden bg-card border-b border-border">
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
            className="md:hidden fixed inset-y-0 left-0 z-40 w-64 bg-sidebar-bg flex flex-col shadow-xl"
          >
            {sidebarContent}
          </aside>
        </>
      )}

      <main className={`flex-1 min-w-0 flex flex-col ${collapsed ? 'md:pl-16' : 'md:pl-64'} transition-[padding] duration-200`}>
        {/* Always render the tabbed workspace. The Home tab is the default
            landing surface and stays available alongside section tabs.
            Use the actual current URL (not activeSection.to) for the section
            tab so deep links like /hiring/domain-lead/application/:id open in
            the iframe instead of the section root. */}
        <TabWorkspace
          apiRef={workspaceRef}
          initialTabs={[
            { url: '/', label: 'Home' },
            ...(activeSection && location.pathname !== '/'
              ? [{ url: location.pathname + location.search, label: activeSection.label }]
              : []),
          ]}
          onActiveUrlChange={setFocusedTabUrl}
        />
      </main>
    </div>
  )
}
