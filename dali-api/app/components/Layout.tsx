import React, { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useRevalidator } from 'react-router'
import {
  LogOut,
  Calendar,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Briefcase,
  Settings,
  FolderKanban,
  UsersRound,
  Handshake,
  Heart,
  Home,
  Workflow,
  ClipboardList,
  GraduationCap,
  ListTodo,
  HelpCircle,
} from 'lucide-react'
import { userInitials } from '~/lib/display'
import { TabWorkspace, type TabWorkspaceHandle, type OpenTabRequest } from '~/components/TabWorkspace'
import { useOpenTasks, TASKS_CHANGED_EVENT } from '~/components/NotificationBell'
import { DesktopBanner } from '~/components/DesktopBanner'

interface LayoutProps {
  user: { email: string; firstName?: string; lastName?: string }
  photoUrl?: string | null
  isCore?: boolean
  isAdmin?: boolean
  isDomainLead?: boolean
  canViewForms?: boolean
  canViewStaffing?: boolean
  isInterviewer?: boolean
  hasHiringAccess?: boolean
  isLabMentor?: boolean
}

const SIDEBAR_COLLAPSED_KEY = 'dali:sidebar:collapsed'

// One sidebar behavior everywhere: every entry is a childless button that
// opens its surface's hub. Lateral navigation inside an area is the in-page
// AreaPillNav row; the sidebar never nests and never remembers deep links.
type NavEntry = {
  key: string
  label: string
  to: string
  icon: typeof Home
  show: boolean
}

export function Layout({ user, photoUrl, isCore = false, isAdmin = false, isDomainLead = false, canViewForms = false, canViewStaffing = false, isInterviewer = false, hasHiringAccess = false, isLabMentor = false }: LayoutProps) {
  const location = useLocation()
  const { revalidate } = useRevalidator()
  // Held in a ref so the message listener (mounted once) always calls the
  // latest revalidate without needing to re-subscribe.
  const revalidateRef = useRef(revalidate)
  revalidateRef.current = revalidate
  const [focusedTabUrl, setFocusedTabUrl] = useState<string | null>(null)
  // Sidebar highlight follows the focused workspace tab when one is open;
  // otherwise it falls back to the parent route.
  const path = focusedTabUrl ?? location.pathname
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const workspaceRef = useRef<TabWorkspaceHandle | null>(null)

  const openInWorkspace = (req: OpenTabRequest) => {
    workspaceRef.current?.openTab(req)
  }

  // Props bundle for any sidebar button that opens a tab. Adds two browser-
  // style shortcuts on top of the plain "open & focus" left-click:
  //   - Cmd/Ctrl + click  → open to the side (split-pane)
  //   - middle-click       → open in background (don't switch tabs)
  // `auxClick` fires for middle/right-click; we filter to button 1 (middle)
  // and preventDefault so the browser doesn't autoscroll.
  const tabClickProps = (req: OpenTabRequest) => ({
    onClick: (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        workspaceRef.current?.openTabToSide(req)
        return
      }
      // Single-click from the sidebar opens a preview (ephemeral) tab: it reuses
      // the pane's preview slot instead of stacking, so skimming sections never
      // piles up tabs. Promoted to a kept tab on double-click / navigating in it.
      workspaceRef.current?.openTab(req, { ephemeral: true })
    },
    onAuxClick: (e: React.MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      workspaceRef.current?.openTabInBackground(req)
    },
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
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
      } else if (data.type === 'dali:openTabToSide' && typeof data.url === 'string') {
        // Open in a second pane to the side (splitting if needed) — used by an
        // embedded page that wants its target as a split-screen tab, e.g. a
        // project document opening beside the project page.
        workspaceRef.current?.openTabToSide({ url: data.url, label: data.label || data.url })
      } else if (
        data.type === 'dali:setTabLabel' &&
        typeof data.url === 'string' &&
        typeof data.label === 'string'
      ) {
        workspaceRef.current?.setTabLabel(data.url, data.label)
      } else if (data.type === 'dali:profileUpdated') {
        // A profile edit inside a workspace iframe doesn't re-run the shell
        // loader, so re-fetch it to refresh the footer avatar.
        revalidateRef.current()
      } else if (data.type === 'dali:documentTitleChanged') {
        // A doc title edit in one tab (e.g. a split-screen document) doesn't
        // touch a sibling tab's own loader (e.g. the project hub's Documents
        // list). Relay to every open iframe; each one ignores it unless its
        // own listener cares about this pageId.
        workspaceRef.current?.broadcast(data)
      } else if (data.type === TASKS_CHANGED_EVENT) {
        // Confirming/acting on a task inside an iframe (e.g. Home) doesn't
        // touch the shell's task poller. Relay it to a same-window event so
        // the sidebar Tasks count + list refresh immediately.
        window.dispatchEvent(new Event(TASKS_CHANGED_EVENT))
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

  // Every entry navigates to its surface's hub — the area root. Order here is
  // the sidebar order (Calendar/Forms above the areas, matching the old nav).
  const navEntries: NavEntry[] = [
    { key: 'calendar', label: 'Calendar', to: '/calendar', icon: Calendar, show: true },
    { key: 'forms', label: 'Forms', to: '/forms', icon: ClipboardList, show: canViewForms },
    { key: 'hiring', label: 'Hiring', to: '/hiring', icon: Briefcase, show: hasHiringAccess },
    { key: 'projects', label: 'Projects', to: '/projects', icon: FolderKanban, show: true },
    // Hidden from mentees entirely; the routes are gated server-side by
    // canViewMentorship. Mentors only see own-domain notes; Core/Admin see all.
    { key: 'mentorship', label: 'Mentorship', to: '/mentorship', icon: Heart, show: isLabMentor || isCore },
    { key: 'members', label: 'People', to: '/members', icon: UsersRound, show: true },
    { key: 'partners', label: 'Partners', to: '/partners', icon: Handshake, show: true },
    { key: 'education', label: 'Education', to: '/education', icon: GraduationCap, show: true },
    { key: 'internal-processes', label: 'Lab Processes', to: '/internal-processes', icon: Workflow, show: true },
    { key: 'admin-console', label: 'Admin', to: '/admin-console', icon: Settings, show: isCore },
  ].filter((e) => e.show)

  const isEntryActive = (entry: NavEntry) => path.startsWith(entry.to)
  // Label for a workspace tab seeded by direct navigation (deep link) — the
  // entry whose prefix owns the current path, or the footer surfaces
  // (My Tasks / Settings / Help) that have no nav entry.
  const initialTabLabel = path.startsWith('/notifications')
    ? 'My Tasks'
    : path.startsWith('/settings')
      ? 'Settings'
      : path.startsWith('/help')
        ? 'Help'
        : navEntries.find(isEntryActive)?.label

  const initials = userInitials(user)
  const openTasks = useOpenTasks()
  const taskCount = openTasks.length
  const sidebarWidth = collapsed ? 'w-16' : 'w-64'

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className={`h-14 flex items-center flex-shrink-0 ${collapsed ? 'justify-center px-2' : 'justify-between px-3 gap-2'}`}>
        <button
          type="button"
          {...tabClickProps({ url: '/', label: 'Home' })}
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
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              {...tabClickProps({ url: '/help', label: 'Help' })}
              className="hidden md:flex p-1.5 text-white/40 hover:text-white/80 hover:bg-white/5 rounded-md transition"
              aria-label="Help"
              title="Help"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden md:flex p-1.5 text-white/40 hover:text-white/80 hover:bg-white/5 rounded-md transition"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
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
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      {/* Areas + nested sections */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5">
        {(() => {
          const hasTasks = taskCount > 0
          const homeActive = path === '/'
          const tasksActive = path.startsWith('/notifications')
          // "My Tasks" opens the dedicated surface (Open + History tabs). With
          // todos it also sits above one subtab per open todo, each linking to
          // that todo's own target; the header itself goes to /notifications.
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
                  <span className="truncate">My Tasks</span>
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
                {...tabClickProps({ url: '/', label: 'Home' })}
                className={`flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
                  homeActive ? 'text-white' : 'text-white/65 hover:text-white'
                }`}
              >
                <Home className="w-4 h-4 flex-shrink-0" />
                {!collapsed && <span className="truncate">Home</span>}
              </button>
              <div className="flex flex-col">
                <button
                  type="button"
                  title={collapsed ? `My Tasks (${taskCount})` : undefined}
                  {...tabClickProps({ url: '/notifications', label: 'My Tasks' })}
                  className={`relative flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
                    tasksActive || hasTasks ? 'text-white' : 'text-white/40 hover:text-white'
                  }`}
                >
                  {headerInner}
                </button>

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
                            }).then(() =>
                              window.dispatchEvent(new Event(TASKS_CHANGED_EVENT)),
                            )
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
                    {/* Entry point into the full My Tasks surface — Open list
                        plus the browsable cleared/history view. */}
                    <button
                      type="button"
                      {...tabClickProps({ url: '/notifications?tab=history', label: 'My Tasks' })}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-left text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      <span className="truncate">See all →</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )
        })()}
        {navEntries.map((entry) => {
          const active = isEntryActive(entry)
          return (
            <button
              key={entry.key}
              type="button"
              title={collapsed ? entry.label : undefined}
              {...tabClickProps({ url: entry.to, label: entry.label })}
              className={`flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
                active ? 'text-white' : 'text-white/65 hover:text-white'
              }`}
            >
              <entry.icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{entry.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Footer — user + logout */}
      <div className="border-t border-white/10 p-2 flex-shrink-0">
        <div className={`flex items-center gap-1 px-1 py-1 ${collapsed ? 'justify-center' : ''}`}>
          <button
            type="button"
            {...tabClickProps({ url: '/profile', label: 'Profile' })}
            title={collapsed ? 'Open profile' : undefined}
            aria-label="Open profile"
            className={`flex items-center gap-2 rounded-md hover:bg-white/5 transition-colors ${
              collapsed ? 'p-1.5' : 'flex-1 min-w-0 px-2 py-1.5 text-left'
            }`}
          >
            <div className="relative w-8 h-8 flex-shrink-0">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs">
                  {initials}
                </div>
              )}
            </div>
            {!collapsed && (
              <span className="text-xs text-white/80 truncate min-w-0">
                {user.firstName}
              </span>
            )}
          </button>
          {!collapsed && (
            <>
              <button
                type="button"
                {...tabClickProps({ url: '/settings', label: 'Settings' })}
                className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 rounded-md transition flex-shrink-0"
                title="Settings"
                aria-label="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <a
                href="/logout"
                className="p-1.5 text-white/40 hover:text-white/70 hover:bg-white/5 rounded-md transition flex-shrink-0"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="w-4 h-4" />
              </a>
            </>
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
            {...tabClickProps({ url: '/', label: 'Home' })}
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
          <button
            type="button"
            {...tabClickProps({ url: '/help', label: 'Help' })}
            className="p-1.5 text-white/40 hover:text-white/70"
            aria-label="Help"
            title="Help"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <Link
            to="/profile"
            aria-label="Profile"
            className="relative w-8 h-8 rounded-full flex items-center justify-center"
          >
            {photoUrl ? (
              <img
                src={photoUrl}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <span className="w-8 h-8 rounded-full bg-accent-coral text-white flex items-center justify-center font-bold text-xs">
                {initials}
              </span>
            )}
          </Link>
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
            className="md:hidden fixed inset-y-0 left-0 z-40 w-64 bg-sidebar-bg flex flex-col shadow-xl"
          >
            {sidebarContent}
          </aside>
        </>
      )}

      <main className={`flex-1 min-w-0 flex flex-col ${collapsed ? 'md:pl-16' : 'md:pl-64'} transition-[padding] duration-200`}>
        <DesktopBanner />
        {/* Always render the tabbed workspace. The Home tab is the default
            landing surface and stays available alongside section tabs.
            Use the actual current URL (not activeSection.to) for the section
            tab so deep links like /hiring/domain-lead/application/:id open in
            the iframe instead of the section root. */}
        <TabWorkspace
          apiRef={workspaceRef}
          initialTabs={[
            { url: '/', label: 'Home' },
            ...(initialTabLabel && location.pathname !== '/'
              ? [{ url: location.pathname + location.search, label: initialTabLabel }]
              : []),
          ]}
          onActiveUrlChange={setFocusedTabUrl}
        />
      </main>
    </div>
  )
}
