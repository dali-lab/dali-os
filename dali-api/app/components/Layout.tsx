import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation, useMatches } from 'react-router'
import {
  LogOut,
  Calendar,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Home,
  ListTodo,
  HelpCircle,
  Search,
  ChevronsUpDown,
  Check,
} from 'lucide-react'
import type { FavoritePage } from '~/lib/user-pages.server'
import { FavoriteIcon } from '~/components/FavoriteIcon'
import { userInitials } from '~/lib/display'
import { TabWorkspace } from '~/components/TabWorkspace'
import { useOpenTasks, TASKS_CHANGED_EVENT } from '~/components/NotificationBell'
import { DesktopBanner } from '~/components/DesktopBanner'
import { CommandPalette } from '~/components/CommandPalette'
import { useFeatureFlag } from '~/components/FeatureFlags'
import { TablessHistoryNav, useRecordTablessHistory } from '~/components/TablessHistoryNav'
import { setFocusPreference } from '~/lib/focus-mode'
import { cn } from '~/lib/cn'
import { useShellNav } from '~/components/shell-nav'
import { SidebarMenuPanel } from '~/components/SidebarMenuPanel'
import {
  areaForPath,
  pinnedNavItems,
  activeSubtabHref,
  hasSubnavRow,
  visibleAreas,
  visibleSubtabs,
  type NavArea,
  type RoleFlags,
} from '~/lib/nav-areas'

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
  hasActiveHiringAccess?: boolean
  isLabMentor?: boolean
  isInstructor?: boolean
  /** Starred pages/routes, most-recently pinned first (sidebar Favorites). */
  favorites?: FavoritePage[]
  /** Recently opened pages not already starred (sidebar Recent). */
  recents?: FavoritePage[]
  /** Focus mode: hide the sidebar entirely; navigate via ⌘K + breadcrumbs.
   *  A floating launcher keeps search + "show sidebar" reachable. */
  focusMode?: boolean
  // Tabless mode: the routed page content, rendered directly in the main
  // column instead of the tabbed workspace. When provided, the sidebar
  // navigates the top window instead of opening workspace tabs.
  children?: React.ReactNode
}

const SIDEBAR_COLLAPSED_KEY = 'dali:sidebar:collapsed'
// The area shown in the sidebar's active-area dropdown when the current route
// isn't itself inside an area (Home / My Tasks / Calendar). Persisted so the
// sidebar reopens on the section you were last working in.
const LAST_AREA_KEY = 'dali:sidebar:area'

// The active-area switcher is the sidebar's primary navigation control now, so
// it has to read as a control. It borrows the full vocabulary of a select
// field: a lit well, a ring you can actually see against navy, and a caret
// fenced off behind its own hairline divider — the one shape nothing else in
// the sidebar has. Faint versions of this read as a section heading sitting
// above the sub-tabs, which is exactly the misread we're fixing.
function areaTriggerClass(open: boolean) {
  return cn(
    'w-full flex items-center gap-3 pl-3 pr-2 py-2 rounded-md',
    'text-sm font-heading font-semibold text-white ring-1 transition-colors',
    open
      ? 'bg-white/[0.20] ring-white/40'
      : 'bg-white/[0.12] ring-white/25 hover:bg-white/[0.18] hover:ring-white/40',
  )
}

// A row inside the area menu. The selected row is marked by a coral icon, a
// coral check and weight — not by a well, which would echo the trigger sitting
// directly above it and read as the same bar drawn twice. Before this it
// differed from the rest by text opacity alone (white vs white/70), which on
// navy is not a state you can see.
function areaOptionClass(selected: boolean) {
  return cn(
    'w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors',
    selected
      ? 'font-semibold text-white'
      : 'text-white/70 hover:bg-white/[0.07] hover:text-white',
  )
}

// Favorites are stored as `pathname + search` and the focused tab url keeps its
// query, so highlight comparisons run on the path alone.
function pathnameOf(p: string) {
  const cut = p.search(/[?#]/)
  return cut === -1 ? p : p.slice(0, cut)
}

// A sub-tab under the open area. Same problem, same fix — plus the coral rail
// below, which lights up the guide line at your position.
function subtabClass(active: boolean, collapsed: boolean) {
  return cn(
    'relative flex items-center gap-2.5 rounded-md text-[13px] font-medium text-left transition-colors',
    collapsed ? 'px-3 py-2 justify-center' : 'px-2.5 py-1.5',
    active
      ? 'bg-white/[0.13] font-semibold text-white'
      : 'text-white/60 hover:bg-white/[0.06] hover:text-white',
  )
}

// Icons take their own contrast ramp rather than inheriting the label's, so a
// glyph reads as a marker instead of dissolving into the word beside it.
function subtabIconClass(active: boolean) {
  return cn(
    'w-4 h-4 flex-shrink-0 transition-colors',
    active ? 'text-accent-coral' : 'text-white/45 group-hover:text-white/90',
  )
}

// The active-sub-tab marker, drawn over the list's guide line so the rule
// itself lights up coral at your position rather than gaining a second stripe.
// Centring is done by a full-height flex wrapper, never by a transform: the
// rail carries no transform at all, so nothing re-rounds its position when the
// entrance animation ends and it can't drift off the row's midline. The
// entrance is opacity-only for the same reason.
function SubtabRail({ collapsed }: { collapsed: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-y-0 flex items-center',
        collapsed ? 'left-0' : '-left-[9px]',
      )}
    >
      <span className="h-4 w-[3px] rounded-full bg-accent-coral motion-safe:animate-nav-rail" />
    </span>
  )
}

export function Layout({ user, photoUrl, isCore = false, isAdmin = false, isDomainLead = false, canViewForms = false, canViewStaffing = false, isInterviewer = false, hasHiringAccess = false, hasActiveHiringAccess = false, isLabMentor = false, isInstructor = false, favorites = [], recents = [], focusMode = false, children }: LayoutProps) {
  const location = useLocation()
  const matches = useMatches()
  // Record every navigation into the shared tabless history store so the
  // desktop back/forward arrows have a stack that survives their host
  // component remounting across page transitions.
  useRecordTablessHistory()
  const tabless = children !== undefined
  // Pages with their own AreaPillNav/UnderlineTabButtons row host the
  // tabless history arrows inline (see TablessHistoryNavInline) — skip the
  // standalone bar there so the arrows don't stack a second row on top.
  // This used to read `areaPills` alone, which got both signals backwards —
  // see hasSubnavRow for why calendar was doubling the row.
  const redesign = useFeatureFlag('sidebar-redesign')
  const ownsSubnavRow = hasSubnavRow(matches, redesign)
  const {
    workspaceRef,
    paletteOpen,
    setPaletteOpen,
    togglePalette,
    openInWorkspace,
    openFromPalette,
    tabClickProps,
  } = useShellNav(tabless)
  const [focusedTabUrl, setFocusedTabUrl] = useState<string | null>(null)
  // Sidebar highlight follows the focused workspace tab when one is open;
  // otherwise it falls back to the parent route.
  const path = focusedTabUrl ?? location.pathname
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // The area the dropdown falls back to on non-area routes. Kept in sync with
  // the route below, and seeded from localStorage on mount.
  const [lastAreaKey, setLastAreaKey] = useState('projects')
  const [areaMenuOpen, setAreaMenuOpen] = useState(false)
  const areaMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
    const savedArea = window.localStorage.getItem(LAST_AREA_KEY)
    if (savedArea) setLastAreaKey(savedArea)
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
    setAreaMenuOpen(false)
  }, [path])

  // Close the active-area menu on an outside click or Escape. The sidebar is a
  // `fixed z-20` stacking context, so a plain fixed overlay would sit above the
  // in-flow menu and swallow option clicks — hence a document listener instead.
  useEffect(() => {
    if (!areaMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (areaMenuRef.current && !areaMenuRef.current.contains(e.target as Node)) {
        setAreaMenuOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAreaMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [areaMenuOpen])

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

  // The sidebar's secondary nav is one "active area" dropdown whose children
  // are that area's sub-tabs. The area auto-follows the current route; on the
  // pinned surfaces (Home / My Tasks / Calendar) it falls back to the last
  // area worked in. Role gating for both the area list and its sub-tabs lives
  // in the nav-areas registry, evaluated against these flags.
  const navRegroup = useFeatureFlag("nav-regroup")
  const navFlags = {
    "nav-regroup": navRegroup,
  }
  const roleFlags: RoleFlags = {
    isCore,
    isAdmin,
    isDomainLead,
    isInterviewer,
    canViewForms,
    canViewStaffing,
    hasHiringAccess,
    hasActiveHiringAccess,
    isLabMentor,
    isInstructor,
  }
  const areas = visibleAreas(roleFlags, navFlags)
  const routeArea = areaForPath(path, navFlags)
  // Drive is pinned under Calendar once the nav is regrouped, so it stops
  // competing with the five role-grouped areas for dropdown space.
  const pinned = pinnedNavItems(navFlags)
  const activeArea = routeArea ?? areas.find((a) => a.key === lastAreaKey) ?? areas[0]
  const activeSubtabs = activeArea ? visibleSubtabs(activeArea, roleFlags) : []
  const activeHref = activeArea ? activeSubtabHref(activeArea, path) : undefined

  // Remember the section as you move through it, so returning to a pinned
  // surface reopens the dropdown where you left off. Persist on area routes only.
  const routeAreaKey = routeArea?.key
  useEffect(() => {
    if (!routeAreaKey) return
    setLastAreaKey(routeAreaKey)
    if (typeof window !== 'undefined') window.localStorage.setItem(LAST_AREA_KEY, routeAreaKey)
  }, [routeAreaKey])

  const selectArea = (area: NavArea, e: React.MouseEvent) => {
    setAreaMenuOpen(false)
    setLastAreaKey(area.key)
    if (typeof window !== 'undefined') window.localStorage.setItem(LAST_AREA_KEY, area.key)
    // Reuse the tab/tabless click behavior (and modifier shortcuts) of a
    // normal sidebar button by invoking its onClick with this event.
    tabClickProps({ url: area.hubPath, label: area.label }).onClick(e)
  }

  // Label for a workspace tab seeded by direct navigation (deep link) — the
  // active area, or the pinned/footer surfaces that aren't areas.
  const pinnedLabel = pinned.find(
    (i) => path === i.href || path.startsWith(i.href + '/'),
  )?.label
  const initialTabLabel = path.startsWith('/notifications')
    ? 'My Tasks'
    : path.startsWith('/calendar')
      ? 'Calendar'
      : path.startsWith('/settings')
        ? 'Settings'
        : path.startsWith('/help')
          ? 'Help'
          : (pinnedLabel ?? routeArea?.label)

  // A Favorites/Recent row: a launcher (open-only) that respects tab/tabless
  // mode. Route favorites get a compass; pages show their emoji or a doc icon.
  // Carries the same active well as a sub-tab so the row you're standing on is
  // marked here too; no rail, because this list has no guide line to light up.
  const renderPageRow = (p: FavoritePage) => {
    const active = pathnameOf(p.href) === pathnameOf(path)
    return (
      <button
        key={p.id}
        type="button"
        title={p.title || 'Untitled'}
        aria-current={active ? 'page' : undefined}
        {...tabClickProps({ url: p.href, label: p.title || 'Untitled' })}
        className={cn(
          'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-left transition-colors',
          active
            ? 'bg-white/[0.13] font-semibold text-white'
            : 'text-white/55 hover:text-white hover:bg-white/5',
        )}
      >
        <FavoriteIcon page={p} glyphClassName={active ? 'text-accent-coral' : 'text-white/40'} />
        <span className="truncate">{p.title || 'Untitled'}</span>
      </button>
    )
  }

  const initials = userInitials(user)
  const openTasks = useOpenTasks()
  const taskCount = openTasks.length
  const sidebarWidth = collapsed ? 'w-16' : 'w-64'

  // Open tasks used to sit inline under the My Tasks row, so the rest of the
  // nav slid down every time one arrived. They hang off the row as a hover
  // flyout instead: fixed-positioned (the scrolling <nav> would clip an
  // absolute panel) and pinned to the sidebar's right edge, so there's no gap
  // for the pointer to fall through on the way over. A short close delay covers
  // the diagonal anyway.
  const tasksRowRef = useRef<HTMLDivElement | null>(null)
  const tasksCloseTimer = useRef<number | null>(null)
  const [tasksFlyout, setTasksFlyout] = useState<{ top: number; left: number } | null>(null)

  const showTasksFlyout = useCallback(() => {
    if (tasksCloseTimer.current !== null) {
      window.clearTimeout(tasksCloseTimer.current)
      tasksCloseTimer.current = null
    }
    const rect = tasksRowRef.current?.getBoundingClientRect()
    // +8 lands the panel on the sidebar's edge (the nav's px-2 gutter).
    if (rect) setTasksFlyout({ top: rect.top, left: rect.right + 8 })
  }, [])

  const hideTasksFlyout = useCallback(() => {
    if (tasksCloseTimer.current !== null) window.clearTimeout(tasksCloseTimer.current)
    tasksCloseTimer.current = window.setTimeout(() => {
      tasksCloseTimer.current = null
      setTasksFlyout(null)
    }, 140)
  }, [])

  const closeTasksFlyoutNow = useCallback(() => {
    if (tasksCloseTimer.current !== null) {
      window.clearTimeout(tasksCloseTimer.current)
      tasksCloseTimer.current = null
    }
    setTasksFlyout(null)
  }, [])

  useEffect(() => () => {
    if (tasksCloseTimer.current !== null) window.clearTimeout(tasksCloseTimer.current)
  }, [])

  // The anchor row scrolls with the nav, so track it while the panel is up.
  useEffect(() => {
    if (!tasksFlyout) return
    window.addEventListener('scroll', showTasksFlyout, true)
    window.addEventListener('resize', showTasksFlyout)
    return () => {
      window.removeEventListener('scroll', showTasksFlyout, true)
      window.removeEventListener('resize', showTasksFlyout)
    }
  }, [tasksFlyout, showTasksFlyout])

  const taskRowClass =
    'flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-left transition-colors'

  const renderTaskRow = (t: ReturnType<typeof useOpenTasks>[number]) => {
    // Meeting invites clear only via RSVP — open My Tasks so
    // Accept/Maybe/Decline are available (same as Home).
    if (t.source === 'meeting') {
      return (
        <button
          key={t.id}
          type="button"
          title={t.title}
          {...tabClickProps({ url: '/notifications', label: 'My Tasks' })}
          onClickCapture={closeTasksFlyoutNow}
          className={`${taskRowClass} w-full text-white/70 hover:text-white hover:bg-white/10`}
        >
          <span className="truncate">{t.title}</span>
        </button>
      )
    }
    return t.link ? (
      <button
        key={t.id}
        type="button"
        title={t.title}
        onClick={() => {
          closeTasksFlyoutNow()
          // Tasks are notification rows — POST /read clears the tile + drops
          // the count once the user acts. Self-clearing tasks (a form to
          // submit, the onboarding checklist) are the exception: opening the
          // link isn't acting on them, so they clear only when their own
          // action completes.
          if (!t.hasAction) {
            fetch(`/api/notifications/${t.id}/read`, {
              method: 'POST',
              credentials: 'include',
              keepalive: true,
            }).then(() => window.dispatchEvent(new Event(TASKS_CHANGED_EVENT)))
          }
          openInWorkspace({ url: t.link!, label: t.title })
        }}
        className={`${taskRowClass} w-full text-white/70 hover:text-white hover:bg-white/10`}
      >
        <span className="truncate">{t.title}</span>
      </button>
    ) : (
      <div key={t.id} title={t.title} className={`${taskRowClass} text-white/45`}>
        <span className="truncate">{t.title}</span>
      </div>
    )
  }

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
      <nav
        data-sidebar-scroll
        className="sidebar-scroll flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-0.5"
      >
        {/* Global search launcher. The palette is otherwise keyboard-only (⌘K);
            this is the visible affordance that makes it discoverable and teaches
            the shortcut — styled like a search field rather than a nav button. */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title="Search (⌘K)"
          aria-label="Search"
          className={`flex items-center rounded-md mb-1 text-sm transition-colors ${
            collapsed
              ? 'px-3 py-2 justify-center text-white/50 hover:text-white hover:bg-white/5'
              : 'gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 text-white/55 hover:text-white/90'
          }`}
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          {!collapsed && (
            <>
              <span className="truncate">Search</span>
              <kbd className="ml-auto text-[10px] font-mono text-white/40 bg-white/10 rounded px-1.5 py-0.5">
                ⌘K
              </kbd>
            </>
          )}
        </button>
        {(() => {
          const hasTasks = taskCount > 0
          const homeActive = path === '/'
          const tasksActive = path.startsWith('/notifications')
          // "My Tasks" opens the dedicated surface (Open + History tabs). With
          // todos, hovering the row also raises a flyout listing them, each
          // linking to that todo's own target; the row itself always goes to
          // /notifications, hover or not.
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
          // the Tasks row.
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
              <div
                ref={tasksRowRef}
                className="flex flex-col"
                onMouseEnter={hasTasks ? showTasksFlyout : undefined}
                onMouseLeave={hideTasksFlyout}
                onFocus={hasTasks ? showTasksFlyout : undefined}
                onBlur={hideTasksFlyout}
              >
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
                {/* Open tasks, hung off the My Tasks row. Fixed rather than absolute so
                    the scrolling <nav> can't clip it; it stays up while the pointer is
                    inside it and closes as soon as a task is opened. */}
                {tasksFlyout && taskCount > 0 && (
                  <div
                    role="group"
                    aria-label="Open tasks"
                    onMouseEnter={showTasksFlyout}
                    onMouseLeave={hideTasksFlyout}
                    style={{
                      top: tasksFlyout.top,
                      left: tasksFlyout.left,
                      maxHeight: `calc(100vh - ${Math.round(tasksFlyout.top) + 16}px)`,
                    }}
                    className="hidden md:flex fixed z-50 w-64 flex-col overflow-y-auto rounded-md bg-sidebar-bg ring-1 ring-white/20 shadow-xl shadow-black/50 p-1 motion-safe:animate-area-menu"
                  >
                    <div className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                      Open tasks
                    </div>
                    {openTasks.map(renderTaskRow)}
                    {/* Entry point into the full My Tasks surface — Open list plus the
                        browsable cleared/history view. */}
                    <button
                      type="button"
                      {...tabClickProps({ url: '/notifications?tab=history', label: 'My Tasks' })}
                      onClickCapture={closeTasksFlyoutNow}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-left text-white/45 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      <span className="truncate">See all →</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )
        })()}
        {/* Calendar — pinned everyday surface alongside Home and My Tasks. */}
        <button
          type="button"
          title={collapsed ? 'Calendar' : undefined}
          {...tabClickProps({ url: '/calendar', label: 'Calendar' })}
          className={`flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
            path.startsWith('/calendar') ? 'text-white' : 'text-white/65 hover:text-white'
          }`}
        >
          <Calendar className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span className="truncate">Calendar</span>}
        </button>
        {pinned.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.href}
              type="button"
              title={collapsed ? item.label : undefined}
              {...tabClickProps({ url: item.href, label: item.label })}
              className={`flex items-center gap-3 rounded-md ${collapsed ? 'px-3 py-2 justify-center' : 'px-3 py-2'} text-sm font-heading font-semibold text-left transition-colors hover:bg-white/5 ${
                path === item.href || path.startsWith(item.href + '/')
                  ? 'text-white'
                  : 'text-white/65 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          )
        })}

        {/* Active-area section: one dropdown that swaps which area's sub-tabs
            show as vertical children. Auto-follows the current route; falls
            back to the last-visited area on the pinned surfaces above. */}
        {activeArea && (
          <div className="mt-2 pt-2 border-t border-white/10 flex flex-col gap-0.5">
            {collapsed ? (
              // No menu chrome fits in a 4rem rail — the area icon links to its
              // hub and its sub-tabs sit beneath it as icons.
              <button
                type="button"
                title={activeArea.label}
                {...tabClickProps({ url: activeArea.hubPath, label: activeArea.label })}
                className="flex items-center justify-center px-3 py-2 rounded-md text-white/90 hover:bg-white/5 transition-colors"
              >
                <activeArea.icon className="w-4 h-4 flex-shrink-0" />
              </button>
            ) : (
              // In-flow (not absolutely positioned): the menu can't be clipped
              // by the scrolling <nav>, and it pushes the sub-tabs down while
              // open. A full-screen catcher closes it on an outside click.
              <div ref={areaMenuRef}>
                <button
                  type="button"
                  onClick={() => setAreaMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={areaMenuOpen}
                  aria-label={`Section: ${activeArea.label}. Switch section`}
                  title="Switch section"
                  className={areaTriggerClass(areaMenuOpen)}
                >
                  <activeArea.icon className="w-4 h-4 flex-shrink-0 text-accent-coral" />
                  <span className="truncate">{activeArea.label}</span>
                  {/* The caret gets its own fenced cell, the way a select's
                      does. A bare glyph floating at the end of the row read as
                      decoration; behind a divider it reads as the handle. */}
                  <span
                    className={cn(
                      'ml-auto self-stretch flex items-center pl-2 border-l transition-colors',
                      areaMenuOpen ? 'border-white/30' : 'border-white/20',
                    )}
                  >
                    <ChevronsUpDown
                      className={cn(
                        'w-4 h-4 flex-shrink-0 transition-colors',
                        areaMenuOpen ? 'text-white' : 'text-white/75',
                      )}
                    />
                  </span>
                </button>
                {areaMenuOpen && (
                  // white/5 over the navy rail lands within a few percent of
                  // the rail itself, so the old panel barely separated from the
                  // nav behind it. A brighter well, a tighter ring and a cast
                  // shadow make it read as a surface sitting above the sidebar.
                  <SidebarMenuPanel
                    role="listbox"
                    className="mt-1 max-h-80 overflow-y-auto rounded-md bg-white/10 ring-1 ring-white/20 shadow-lg shadow-black/40 py-1 motion-safe:animate-area-menu"
                  >
                    {areas.map((a) => {
                        const selected = a.key === activeArea.key
                        return (
                          <button
                            key={a.key}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={(e) => selectArea(a, e)}
                            className={areaOptionClass(selected)}
                          >
                            <a.icon
                              className={cn(
                                'w-4 h-4 flex-shrink-0',
                                selected ? 'text-accent-coral' : 'text-white/45',
                              )}
                            />
                            <span className="truncate">{a.label}</span>
                            {selected && (
                              <Check className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-accent-coral" />
                            )}
                          </button>
                        )
                      })}
                  </SidebarMenuPanel>
                )}
              </div>
            )}

            {!areaMenuOpen && activeSubtabs.length > 0 && (
              <div className={collapsed ? 'flex flex-col gap-0.5' : 'ml-4 pl-2 border-l border-white/10 flex flex-col gap-0.5'}>
                {activeSubtabs.map((t) => {
                  const active = t.href === activeHref
                  return (
                    <button
                      key={t.href}
                      type="button"
                      title={collapsed ? t.label : undefined}
                      {...tabClickProps({ url: t.href, label: t.label })}
                      className={cn('group', subtabClass(active, collapsed))}
                    >
                      {active && <SubtabRail collapsed={collapsed} />}
                      <t.icon className={subtabIconClass(active)} />
                      {!collapsed && <span className="truncate">{t.label}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Favorites + Recent — starred and recently opened pages, from the
            same source as the Home panel. Hidden collapsed (text-first rows).
            Recent refreshes on shell reload / tabless nav, not on in-iframe
            moves. */}
        {!collapsed && (favorites.length > 0 || recents.length > 0) && (
          <div className="mt-2 pt-2 border-t border-white/10 flex flex-col gap-3">
            {favorites.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <div className="px-2.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/60">Favorites</div>
                {favorites.map(renderPageRow)}
              </div>
            )}
            {recents.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <div className="px-2.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/60">Recent</div>
                {recents.map(renderPageRow)}
              </div>
            )}
          </div>
        )}
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
      {/* Desktop sidebar — omitted entirely in focus mode. */}
      {!focusMode && (
        <aside
          className={`hidden md:flex flex-col fixed inset-y-0 left-0 z-20 ${sidebarWidth} bg-sidebar-bg transition-[width] duration-200`}
        >
          {sidebarContent}
        </aside>
      )}

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

      <main className={`flex-1 min-w-0 flex flex-col ${focusMode ? '' : collapsed ? 'md:pl-16' : 'md:pl-64'} transition-[padding] duration-200`}>
        <DesktopBanner />
        {/* Tabless mode renders the routed page directly here; otherwise the
            tabbed workspace. The Home tab is the workspace's default landing
            surface and stays available alongside section tabs. Use the actual
            current URL (not activeSection.to) for the section tab so deep links
            like /hiring/domain-lead/application/:id open in the iframe instead
            of the section root. */}
        {tabless ? (
          <div className="flex flex-1 min-h-0 flex-col">
            {!ownsSubnavRow && <TablessHistoryNav />}
            {children}
          </div>
        ) : (
          <TabWorkspace
            apiRef={workspaceRef}
            onOpenPalette={togglePalette}
            initialTabs={[
              { url: '/', label: 'Home' },
              ...(initialTabLabel && location.pathname !== '/'
                ? [{ url: location.pathname + location.search, label: initialTabLabel }]
                : []),
            ]}
            onActiveUrlChange={setFocusedTabUrl}
          />
        )}
      </main>

      {/* Focus-mode launcher: with the sidebar hidden, keep a persistent way to
          search (⌘K) and to bring the sidebar back. Desktop only — mobile keeps
          its top bar + drawer. */}
      {focusMode && (
        <div className="hidden md:flex fixed bottom-4 left-4 z-30 items-center gap-1 rounded-xl bg-sidebar-bg shadow-brand-2 p-1">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Search (⌘K)"
            aria-label="Search"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 text-sm transition-colors"
          >
            <Search className="w-4 h-4" />
            <kbd className="text-[10px] font-mono text-white/40 bg-white/10 rounded px-1 py-0.5">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              setFocusPreference(false)
              window.location.reload()
            }}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabless={tabless}
        focusMode={focusMode}
        roles={roleFlags}
        onOpen={openFromPalette}
      />
    </div>
  )
}
