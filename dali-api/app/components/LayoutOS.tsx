import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useLocation, useMatches } from 'react-router'
import {
  Bell,
  Calendar,
  Check,
  ChevronsUpDown,
  HelpCircle,
  Home,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Star,
  UserRound,
  X,
} from 'lucide-react'
import type { FavoritePage } from '~/lib/user-pages.server'
import { FavoriteIcon } from '~/components/FavoriteIcon'
import { userInitials } from '~/lib/display'
import { TabWorkspace } from '~/components/TabWorkspace'
import { useOpenTasks, TASKS_CHANGED_EVENT } from '~/components/NotificationBell'
import { DesktopBanner } from '~/components/DesktopBanner'
import { CommandPalette } from '~/components/CommandPalette'
import { PageDocButton, ShellGuideProvider } from '~/components/page-docs/PageDocButton'
import { TablessHistoryNav, useRecordTablessHistory } from '~/components/TablessHistoryNav'
import { useShellNav } from '~/components/shell-nav'
import { setFocusPreference } from '~/lib/focus-mode'
import { useOsShellRoot } from '~/lib/os-shell'
import { cn } from '~/lib/cn'
import {
  areaForPath,
  pinnedNavItems,
  activeSubtabHref,
  hasSubnavRow,
  isPinnedActive,
  visibleAreas,
  visibleSubtabs,
  type NavArea,
  type RoleFlags,
} from '~/lib/nav-areas'

interface LayoutOSProps {
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
  /** Starred pages/routes, most-recently pinned first — carried by the top bar. */
  favorites?: FavoritePage[]
  focusMode?: boolean
  children?: React.ReactNode
}

const SIDEBAR_COLLAPSED_KEY = 'dali:sidebar:collapsed'
const LAST_AREA_KEY = 'dali:sidebar:area'

/* ------------------------------------------------------------------ */
/* The dali.os shell. Same navigation model as the default shell — one  */
/* pinned group, one active-area switcher, its sub-tabs beneath — but   */
/* two of the rail's jobs move out to a top bar so the rail is only     */
/* ever navigation: favourites become a strip along the top, and open   */
/* tasks become the bell beside them. Nothing is dropped; the rows the  */
/* design has no place for (profile, settings, help, log out) hang off  */
/* the user row at the foot of the rail as a menu.                      */
/* ------------------------------------------------------------------ */

// Every floating panel in the design is one material: the card fill, a hairline
// container border, 14px corners and a cast shadow. Not the card *hover* fill —
// that's a state a card takes on under the pointer, so a panel painted with it
// reads as a different surface from the card it drops out of, which is what
// made the account menu look out of place against the rail.
const osMenuClass =
  'rounded-[14px] border border-os-container bg-os-card p-1.5 shadow-[0_12px_32px_var(--color-os-shadow)]'

// A row inside one. Full-strength text — a menu's rows are all equally
// available, so greying them is a state that isn't true of any of them.
const osMenuItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-os-container'

// A rail row. The active state is the design's marker: a filled well whose
// left border is the accent stripe, square on that edge so it reads as
// attached to the rail rather than as a floating pill.
function railRowClass(active: boolean, collapsed: boolean) {
  return cn(
    'flex items-center gap-3 text-base text-left transition-colors',
    collapsed ? 'justify-center px-3 py-2 rounded-os-item' : 'px-3 py-2',
    active
      ? cn('font-medium text-foreground', !collapsed && 'os-subtab-active pl-[10px]')
      : 'font-normal text-os-grey hover:bg-os-hover hover:text-foreground',
    collapsed && active && 'bg-os-container text-foreground',
  )
}

export function LayoutOS({
  user,
  photoUrl,
  isCore = false,
  isAdmin = false,
  isDomainLead = false,
  canViewForms = false,
  canViewStaffing = false,
  isInterviewer = false,
  hasHiringAccess = false,
  hasActiveHiringAccess = false,
  isLabMentor = false,
  isInstructor = false,
  favorites = [],
  focusMode = false,
  children,
}: LayoutOSProps) {
  const location = useLocation()
  const matches = useMatches()
  useRecordTablessHistory()
  const tabless = children !== undefined
  // This shell always owns the sub-tabs in its rail, so the in-page pill row is
  // gone whatever `sidebar-redesign` says — pass the redesigned-row rule flat.
  const ownsSubnavRow = hasSubnavRow(matches, true)
  useOsShellRoot(true)

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
  // The live url, query included — the nav matchers trim it themselves, but they
  // need the query to tell a Core deep-link into the Drive (/drive?type=agreement)
  // from the plain Drive pin. In tab mode the focused-tab url already carries it;
  // in tabless mode location.pathname would drop it, so append the search.
  const path = focusedTabUrl ?? location.pathname + location.search
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [lastAreaKey, setLastAreaKey] = useState('projects')
  const [areaMenuOpen, setAreaMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const areaMenuRef = useRef<HTMLDivElement | null>(null)
  const areaTriggerRef = useRef<HTMLButtonElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
    const savedArea = window.localStorage.getItem(LAST_AREA_KEY)
    if (savedArea) setLastAreaKey(savedArea)
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
    setAreaMenuOpen(false)
    setUserMenuOpen(false)
  }, [path])

  // Both rail menus sit inside a `fixed z-20` stacking context, so a plain
  // overlay would cover them and swallow option clicks — hence document
  // listeners, matching the default shell.
  useEffect(() => {
    if (!areaMenuOpen && !userMenuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (areaMenuRef.current && !areaMenuRef.current.contains(t)) setAreaMenuOpen(false)
      if (userMenuRef.current && !userMenuRef.current.contains(t)) setUserMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setAreaMenuOpen(false)
      setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [areaMenuOpen, userMenuOpen])

  // The section menu is pinned to the trigger's box rather than laid out under
  // it, so its position is measured — on open, and again on resize/scroll while
  // it is open so it can't drift away from the button it belongs to.
  const [areaMenuRect, setAreaMenuRect] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)

  const measureAreaMenu = useCallback(() => {
    const rect = areaTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAreaMenuRect({ top: rect.bottom + 8, left: rect.left, width: rect.width })
  }, [])

  const toggleAreaMenu = useCallback(() => {
    setAreaMenuOpen((v) => {
      if (!v) measureAreaMenu()
      return !v
    })
  }, [measureAreaMenu])

  useEffect(() => {
    if (!areaMenuOpen) return
    window.addEventListener('resize', measureAreaMenu)
    // Capture phase: the rail is its own scroller, and a scroll there doesn't
    // bubble to window.
    window.addEventListener('scroll', measureAreaMenu, true)
    return () => {
      window.removeEventListener('resize', measureAreaMenu)
      window.removeEventListener('scroll', measureAreaMenu, true)
    }
  }, [areaMenuOpen, measureAreaMenu])

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

  // The nav-regroup flag was retired; the nav-areas registry no longer branches
  // on any flag, so an empty map is all the helpers need.
  const navFlags = {}
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
  const pinned = pinnedNavItems(navFlags)
  const activeArea = routeArea ?? areas.find((a) => a.key === lastAreaKey) ?? areas[0]
  const activeSubtabs = activeArea ? visibleSubtabs(activeArea, roleFlags) : []
  const activeHref = activeArea ? activeSubtabHref(activeArea, path) : undefined

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
    tabClickProps({ url: area.hubPath, label: area.label }).onClick(e)
  }

  const pinnedLabel = pinned.find((i) => isPinnedActive(path, i.href, navFlags))?.label
  const initialTabLabel = path.startsWith('/notifications')
    ? 'My Tasks'
    : path.startsWith('/calendar')
      ? 'Calendar'
      : path.startsWith('/settings')
        ? 'Settings'
        : path.startsWith('/help')
          ? 'Help'
          : (pinnedLabel ?? routeArea?.label)

  const initials = userInitials(user)
  const openTasks = useOpenTasks()
  const taskCount = openTasks.length

  /* ---------------- Task bell flyout (top bar) ---------------- */
  // The bell replaces the rail's My Tasks row, so it has to carry that row's
  // hover list too — otherwise the open tasks are one navigation further away
  // than they are today. Fixed-positioned and pinned under the bell.
  const bellRef = useRef<HTMLDivElement | null>(null)
  const bellCloseTimer = useRef<number | null>(null)
  const [bellFlyout, setBellFlyout] = useState<{ top: number; right: number } | null>(null)

  const showBellFlyout = useCallback(() => {
    if (bellCloseTimer.current !== null) {
      window.clearTimeout(bellCloseTimer.current)
      bellCloseTimer.current = null
    }
    const rect = bellRef.current?.getBoundingClientRect()
    if (rect) {
      setBellFlyout({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    }
  }, [])

  const hideBellFlyout = useCallback(() => {
    if (bellCloseTimer.current !== null) window.clearTimeout(bellCloseTimer.current)
    bellCloseTimer.current = window.setTimeout(() => {
      bellCloseTimer.current = null
      setBellFlyout(null)
    }, 140)
  }, [])

  const closeBellFlyoutNow = useCallback(() => {
    if (bellCloseTimer.current !== null) {
      window.clearTimeout(bellCloseTimer.current)
      bellCloseTimer.current = null
    }
    setBellFlyout(null)
  }, [])

  useEffect(
    () => () => {
      if (bellCloseTimer.current !== null) window.clearTimeout(bellCloseTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (!bellFlyout) return
    window.addEventListener('resize', showBellFlyout)
    return () => window.removeEventListener('resize', showBellFlyout)
  }, [bellFlyout, showBellFlyout])

  // The flyout is one of the panels above, so its rows are menu rows.
  const taskRowClass = osMenuItemClass

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
          onClickCapture={closeBellFlyoutNow}
          className={taskRowClass}
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
          closeBellFlyoutNow()
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
        className={taskRowClass}
      >
        <span className="truncate">{t.title}</span>
      </button>
    ) : (
      <div key={t.id} title={t.title} className={cn(taskRowClass, 'text-os-muted hover:bg-transparent')}>
        <span className="truncate">{t.title}</span>
      </div>
    )
  }

  /* ---------------- Rail ---------------- */

  const avatar = (size: string) =>
    photoUrl ? (
      <img src={photoUrl} alt="" className={`${size} rounded-full object-cover`} />
    ) : (
      <span
        className={`${size} flex items-center justify-center rounded-full bg-os-container text-[10px] font-bold text-foreground`}
      >
        {initials}
      </span>
    )

  const userMenuItems = [
    { url: '/profile', label: 'Profile', icon: UserRound },
    { url: '/settings', label: 'Settings', icon: Settings },
    { url: '/help', label: 'Help', icon: HelpCircle },
  ]

  const sidebarContent = (
    <div
      data-sidebar-scroll
      className="flex h-full flex-col justify-between overflow-y-auto px-5 py-6"
    >
      {/* Everything in the rail holds its height (`shrink-0`) except the
          sub-tab list, which is the one part that grows without bound — a
          10-sub-tab area is taller than a laptop window on its own. `min-h-0`
          here and on the group below is what lets flexbox shrink past content,
          so the squeeze lands on that list and it scrolls inside its own box
          instead of scrolling the whole rail and carrying the wordmark, the
          search box and the section switcher off the top of the screen. */}
      <div className={cn('flex min-h-0 flex-col', collapsed ? 'gap-4' : 'gap-6')}>
        {/* Brand + collapse */}
        <div
          className={cn(
            'flex shrink-0 items-center',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          {!collapsed && (
            <button
              type="button"
              {...tabClickProps({ url: '/', label: 'Home' })}
              className="font-os-logo text-2xl font-semibold text-os-accent focus:outline-none"
              title="Home"
            >
              dali.os
            </button>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-os-grey transition-colors hover:bg-os-hover hover:text-foreground"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeftClose className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>

        {/* Search — the visible affordance for the ⌘K palette. */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title="Search (⌘K)"
          aria-label="Search"
          className={cn(
            'flex shrink-0 items-center rounded-os-item bg-os-card text-base text-os-grey transition-colors hover:text-foreground',
            collapsed ? 'justify-center p-2.5' : 'gap-3 p-3',
          )}
        >
          <Search className="h-[18px] w-[18px] flex-shrink-0 opacity-80" />
          {!collapsed && (
            <>
              <span>Search</span>
              <kbd className="ml-auto rounded bg-os-container px-1.5 py-0.5 font-mono text-[10px] text-os-muted">
                ⌘K
              </kbd>
            </>
          )}
        </button>

        {/* Pinned surfaces */}
        <div className="flex shrink-0 flex-col gap-3">
          <button
            type="button"
            title={collapsed ? 'Home' : undefined}
            {...tabClickProps({ url: '/', label: 'Home' })}
            className={railRowClass(path === '/', collapsed)}
          >
            <Home className="h-5 w-5 flex-shrink-0 opacity-85" />
            {!collapsed && 'Home'}
          </button>
          <button
            type="button"
            title={collapsed ? 'Calendar' : undefined}
            {...tabClickProps({ url: '/calendar', label: 'Calendar' })}
            className={railRowClass(path.startsWith('/calendar'), collapsed)}

          >
            <Calendar className="h-5 w-5 flex-shrink-0 opacity-85" />
            {!collapsed && 'Calendar'}
          </button>
          {pinned.map((item) => {
            const Icon = item.icon
            const active = isPinnedActive(path, item.href, navFlags)
            return (
              <button
                key={item.href}
                type="button"
                title={collapsed ? item.label : undefined}
                {...tabClickProps({ url: item.href, label: item.label })}
                className={railRowClass(active, collapsed)}
              >
                <Icon className="h-5 w-5 flex-shrink-0 opacity-85" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            )
          })}
        </div>

        {activeArea && (
          <>
            <div className="h-px w-full shrink-0 bg-os-container" />

            {/* Active-area switcher + its sub-tabs. */}
            {collapsed ? (
              <div className="flex min-h-0 flex-col gap-3">
                <button
                  type="button"
                  title={activeArea.label}
                  {...tabClickProps({ url: activeArea.hubPath, label: activeArea.label })}
                  className="flex shrink-0 items-center justify-center rounded-os-item bg-os-card px-3 py-2.5 text-foreground transition-colors hover:bg-os-card-hover"
                >
                  <activeArea.icon className="h-5 w-5 flex-shrink-0" />
                </button>
                <div className="flex min-h-[5rem] flex-col gap-3 overflow-y-auto">
                  {activeSubtabs.map((t) => (
                    <button
                      key={t.href}
                      type="button"
                      title={t.label}
                      {...tabClickProps({ url: t.href, label: t.label })}
                      className={railRowClass(t.href === activeHref, collapsed)}
                    >
                      <t.icon className="h-5 w-5 flex-shrink-0 opacity-85" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-col gap-3">
                <div ref={areaMenuRef} className="shrink-0">
                  <button
                    type="button"
                    onClick={toggleAreaMenu}
                    aria-haspopup="listbox"
                    aria-expanded={areaMenuOpen}
                    aria-label={`Section: ${activeArea.label}. Switch section`}
                    title="Switch section"
                    ref={areaTriggerRef}
                    className={cn(
                      'flex w-full items-center justify-between rounded-os-item p-3 text-base transition-colors',
                      areaMenuOpen
                        ? 'bg-os-card-hover text-foreground'
                        : 'bg-os-card text-os-grey hover:text-foreground',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <activeArea.icon className="h-5 w-5 flex-shrink-0 text-os-accent" />
                      <span className="truncate">{activeArea.label}</span>
                    </span>
                    <ChevronsUpDown className="h-5 w-5 flex-shrink-0" />
                  </button>
                  {areaMenuOpen && areaMenuRect && (
                    // Fixed to the viewport, not in the rail's flow — the same
                    // trick the task-bell flyout below uses, and for the same
                    // reason. In flow, a list this long simply made the rail
                    // taller than the window and the *rail* scrolled, carrying
                    // the trigger and the account row out of view; absolute
                    // wouldn't help either, since the rail is a scroll
                    // container and would clip it. Out of flow it can't change
                    // the rail's height at all, and the max-height below is
                    // measured from the viewport, so a list too long to fit
                    // always scrolls inside its own box.
                    // Still a DOM child of areaMenuRef, so the outside-click
                    // handler keeps working unchanged.
                    <div
                      role="listbox"
                      style={{
                        top: areaMenuRect.top,
                        left: areaMenuRect.left,
                        width: areaMenuRect.width,
                        maxHeight: `calc(100vh - ${Math.round(areaMenuRect.top) + 16}px)`,
                      }}
                      className={cn(
                        'fixed z-40 overflow-y-auto motion-safe:animate-area-menu',
                        osMenuClass,
                      )}
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
                            className={cn(osMenuItemClass, selected && 'font-semibold')}
                          >
                            <a.icon
                              className={cn(
                                'h-4 w-4 flex-shrink-0',
                                selected ? 'text-os-accent' : 'text-os-grey',
                              )}
                            />
                            <span className="truncate">{a.label}</span>
                            {selected && (
                              <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-os-accent" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {!areaMenuOpen && activeSubtabs.length > 0 && (
                  // min-h-[5rem]: on a window too short even for this, keep the
                  // list a list and let the rail take the remainder, rather
                  // than squeezing it to a sliver.
                  <div className="flex min-h-[5rem] flex-col gap-3 overflow-y-auto border-l-2 border-os-container pr-2">
                    {activeSubtabs.map((t) => {
                      const active = t.href === activeHref
                      return (
                        <button
                          key={t.href}
                          type="button"
                          {...tabClickProps({ url: t.href, label: t.label })}
                          className={cn(
                            'flex items-center gap-3 py-2 text-base text-left transition-colors',
                            active
                              ? 'os-subtab-active pl-[22px] font-medium text-foreground'
                              : 'pl-6 font-normal text-os-grey hover:bg-os-hover hover:text-foreground',
                          )}
                        >
                          <t.icon className="h-5 w-5 flex-shrink-0 opacity-85" />
                          <span className="truncate">{t.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* User row — the design's foot of the rail. It also carries the rows
          the design has no other home for (profile, settings, help, log out)
          rather than dropping them. */}
      <div ref={userMenuRef} className="relative shrink-0 pt-6">
        {userMenuOpen && (
          <div
            role="menu"
            className={cn(
              'absolute bottom-full left-0 mb-2 w-full min-w-[180px] motion-safe:animate-area-menu',
              osMenuClass,
            )}
          >
            {userMenuItems.map((item) => (
              <button
                key={item.url}
                type="button"
                role="menuitem"
                {...tabClickProps({ url: item.url, label: item.label })}
                className={osMenuItemClass}
              >
                <item.icon className="h-4 w-4 flex-shrink-0 text-os-grey" />
                {item.label}
              </button>
            ))}
            <a
              href="/logout"
              role="menuitem"
              className={osMenuItemClass}
            >
              <LogOut className="h-4 w-4 flex-shrink-0 text-os-grey" />
              Log out
            </a>
          </div>
        )}
        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
          title={collapsed ? `${user.firstName ?? user.email} — account menu` : 'Account menu'}
          className={cn(
            'flex w-full items-center gap-3 rounded-os-item px-3 py-2 transition-colors hover:bg-os-hover',
            collapsed && 'justify-center px-0',
          )}
        >
          {avatar('h-6 w-6')}
          {!collapsed && (
            <span className="truncate text-base font-medium text-os-grey">
              {[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}
            </span>
          )}
        </button>
      </div>
    </div>
  )

  /* ---------------- Top bar ---------------- */

  const topBar = (
    <div className="os-nav-edge-b flex items-center justify-between gap-4 border-l-2 border-os-bg bg-os-nav px-6 py-4">
      {favorites.length === 0 ? (
        <div className="flex items-center gap-3 text-base text-os-muted">
          <Star className="h-5 w-5 flex-shrink-0 opacity-70" />
          Favorited pages will appear here.
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
          <Star className="h-5 w-5 flex-shrink-0 text-os-accent" aria-hidden />
          <div className="flex items-center gap-2">
            {favorites.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.title || 'Untitled'}
                {...tabClickProps({ url: p.href, label: p.title || 'Untitled' })}
                className="flex max-w-[180px] flex-shrink-0 items-center gap-2 rounded-full bg-os-card px-3 py-1.5 text-sm text-os-grey transition-colors hover:bg-os-card-hover hover:text-foreground"
              >
                <FavoriteIcon page={p} glyphClassName="text-os-accent" />
                <span className="truncate">{p.title || 'Untitled'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-shrink-0 items-center gap-3">
        {/* The page's guide, on the same plate as the bell beside it. Renders
            only where the shell knows the route (tabless); in tab mode the
            iframe carries its own copy, since the docKey lives in there. */}
        <PageDocButton variant="topbar" />
        <div
          ref={bellRef}
          className="relative"
          onMouseEnter={taskCount > 0 ? showBellFlyout : undefined}
          onMouseLeave={hideBellFlyout}
        >
          <button
            type="button"
            {...tabClickProps({ url: '/notifications', label: 'My Tasks' })}
            aria-label={`My Tasks — ${taskCount} open task${taskCount === 1 ? '' : 's'}`}
            title={`My Tasks (${taskCount})`}
            className="os-topbar-btn pl-3"
          >
            <Bell className="h-5 w-5" />
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-sm font-black',
                taskCount > 0 ? 'bg-os-accent text-os-bg' : 'bg-os-container text-os-grey',
              )}
            >
              {taskCount > 99 ? '99+' : taskCount}
            </span>
          </button>
        </div>
      </div>
    </div>
  )

  const sidebarWidth = collapsed ? 'w-[76px]' : 'w-[276px]'
  const mainPad = collapsed ? 'md:pl-[76px]' : 'md:pl-[276px]'

  return (
    <div className="os-shell flex min-h-screen min-h-dvh flex-col bg-os-bg pt-14 text-foreground md:flex-row md:pt-0">
      {!focusMode && (
        <aside
          className={cn(
            'os-nav-edge-r fixed inset-y-0 left-0 z-20 hidden flex-col bg-os-nav transition-[width] duration-200 md:flex',
            sidebarWidth,
          )}
        >
          {sidebarContent}
        </aside>
      )}

      {/* Mobile top bar */}
      <div className="os-nav-edge-b fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between bg-os-nav px-4 md:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="-ml-1.5 p-1.5 text-os-grey hover:text-foreground"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="os-mobile-nav"
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <button
            type="button"
            {...tabClickProps({ url: '/', label: 'Home' })}
            className="font-os-logo text-xl font-semibold text-os-accent"
            title="Home"
          >
            dali.os
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            {...tabClickProps({ url: '/notifications', label: 'My Tasks' })}
            className="relative p-1.5 text-os-grey hover:text-foreground"
            aria-label={`My Tasks — ${taskCount} open`}
          >
            <Bell className="h-5 w-5" />
            {taskCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-os-accent px-1 text-[10px] font-black text-os-bg">
                {taskCount > 9 ? '9+' : taskCount}
              </span>
            )}
          </button>
          <Link to="/profile" aria-label="Profile" className="flex items-center">
            {avatar('h-8 w-8')}
          </Link>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-os-overlay md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside
            id="os-mobile-nav"
            className="os-nav-edge-r fixed inset-y-0 left-0 z-40 flex w-[276px] flex-col bg-os-nav shadow-xl md:hidden"
          >
            {sidebarContent}
          </aside>
        </>
      )}

      <main
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[padding] duration-200',
          !focusMode && mainPad,
        )}
      >
        {!focusMode && <div className="hidden md:block">{topBar}</div>}
        <DesktopBanner />
        {tabless ? (
          <ShellGuideProvider>
            <div className="flex min-h-0 flex-1 flex-col">
              {!ownsSubnavRow && <TablessHistoryNav />}
              {children}
            </div>
          </ShellGuideProvider>
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

      {/* Open tasks, hung off the bell. Fixed rather than absolute so the top
          bar's overflow can't clip it. */}
      {bellFlyout && taskCount > 0 && (
        <div
          role="group"
          aria-label="Open tasks"
          onMouseEnter={showBellFlyout}
          onMouseLeave={hideBellFlyout}
          style={{
            top: bellFlyout.top,
            right: bellFlyout.right,
            maxHeight: `calc(100vh - ${Math.round(bellFlyout.top) + 16}px)`,
          }}
          className={cn(
            'fixed z-50 hidden w-72 flex-col overflow-y-auto md:flex motion-safe:animate-area-menu',
            osMenuClass,
          )}
        >
          <div className="px-3 pb-1.5 pt-1 text-[11px] font-bold uppercase tracking-wide text-os-muted">
            Open tasks
          </div>
          {openTasks.map(renderTaskRow)}
          <button
            type="button"
            {...tabClickProps({ url: '/notifications?tab=history', label: 'My Tasks' })}
            onClickCapture={closeBellFlyoutNow}
            className={cn(taskRowClass, 'text-os-grey')}
          >
            <span className="truncate">See all →</span>
          </button>
        </div>
      )}

      {/* Focus mode: with the rail hidden, keep search + a way back. */}
      {focusMode && (
        <div className={cn('fixed bottom-4 left-4 z-30 hidden items-center gap-1 md:flex', osMenuClass)}>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Search (⌘K)"
            aria-label="Search"
            className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-os-grey transition-colors hover:bg-os-hover-strong hover:text-foreground"
          >
            <Search className="h-4 w-4" />
            <kbd className="rounded bg-os-container px-1 py-0.5 font-mono text-[10px] text-os-muted">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => {
              setFocusPreference(false)
              window.location.reload()
            }}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="rounded-lg p-2 text-os-muted transition-colors hover:bg-os-hover-strong hover:text-foreground"
          >
            <PanelLeftOpen className="h-4 w-4" />
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
