import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Bell, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from 'lucide-react'
import { Tooltip } from '~/components/ui/floating'
import { userInitials } from '~/lib/display'
import { useAttentionFeed } from '~/components/NotificationBell'
import { AttentionPanel, attentionCount } from '~/components/AttentionPanel'
import { CommandPalette } from '~/components/CommandPalette'
import { useShellNav } from '~/components/shell-nav'
import { useOsShellRoot } from '~/lib/os-shell'
import { osMenuClass, osMenuItemClass, railRowClass } from '~/components/os-shell-chrome'
import { PORTAL_NAV, isPortalNavActive } from '~/lib/portal-nav'
import { cn } from '~/lib/cn'

/* ------------------------------------------------------------------ */
/* The dali.os shell for non-members. Same rail, same material and the  */
/* same ⌘K as the member shell — a student is in the same product, not  */
/* a cut-down copy of it — with the parts that describe lab membership  */
/* left out rather than shown empty: no area switcher (their four       */
/* surfaces are all direct rows), no Drive, no favourites strip, no     */
/* tabbed workspace. The top bar keeps the task bell, which is how an   */
/* offering reaches them.                                              */
/* ------------------------------------------------------------------ */

const SIDEBAR_COLLAPSED_KEY = 'dali:sidebar:collapsed'

interface LayoutPortalOSProps {
  user: { email: string; firstName?: string; lastName?: string }
  photoUrl?: string | null
  /** The routed page fills the shell's main column rather than growing past
   *  it (see `handle.fitViewport` — the calendar's hour grid). */
  fitViewport?: boolean
  children: React.ReactNode
}

export function LayoutPortalOS({ user, photoUrl, fitViewport = false, children }: LayoutPortalOSProps) {
  const location = useLocation()
  const path = location.pathname + location.search
  useOsShellRoot(true)

  // The portal never renders the tabbed workspace, so the shell is always in
  // its tabless mode: rows navigate the top window and ⌘K is listened for here.
  const { paletteOpen, setPaletteOpen, openInWorkspace, openFromPalette, tabClickProps } =
    useShellNav(true)

  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1')
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
    setUserMenuOpen(false)
  }, [path])

  // The rail sits in a `fixed z-20` stacking context, so an overlay would cover
  // the account menu and swallow its clicks — document listeners instead,
  // matching the member shell.
  useEffect(() => {
    if (!userMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [userMenuOpen])

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

  const initials = userInitials(user)
  const { tasks: openTasks, items: feedItems } = useAttentionFeed()
  const taskCount = attentionCount(openTasks, feedItems)

  /* ---------------- Attention panel (bell, top bar) ---------------- */
  // Click-to-open rather than hover: the cards carry buttons, and a hover panel
  // closes under the pointer on the way to one. Fixed-positioned so the top
  // bar's overflow can't clip it, but still a DOM child of the bell so the
  // outside-click handler treats acting on a card as a click inside.
  const bellRef = useRef<HTMLDivElement | null>(null)
  const [bellPanel, setBellPanel] = useState<{ top: number; right: number } | null>(null)

  const bellAnchor = useCallback(() => {
    const rect = bellRef.current?.getBoundingClientRect()
    return rect ? { top: rect.bottom + 8, right: window.innerWidth - rect.right } : null
  }, [])

  const placeBellPanel = useCallback(() => setBellPanel(bellAnchor()), [bellAnchor])
  const closeBellPanel = useCallback(() => setBellPanel(null), [])
  const toggleBellPanel = useCallback(
    () => setBellPanel((open) => (open ? null : bellAnchor())),
    [bellAnchor],
  )

  useEffect(() => {
    if (!bellPanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBellPanel()
    }
    const onDown = (e: MouseEvent) => {
      if (!bellRef.current?.contains(e.target as Node)) closeBellPanel()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', placeBellPanel)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', placeBellPanel)
    }
  }, [bellPanel, closeBellPanel, placeBellPanel])

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

  // `collapsed` is passed as a parameter so the mobile drawer can render full
  // labels (force false) while the desktop rail keeps its own state.
  const renderSidebar = (collapsed: boolean) => (
    <div data-sidebar-scroll className="flex h-full flex-col justify-between overflow-y-auto px-5 py-6">
      <div className={cn('flex min-h-0 flex-col', collapsed ? 'gap-4' : 'gap-6')}>
        {/* Brand + collapse */}
        <div className={cn('flex shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && (
            <button
              type="button"
              {...tabClickProps({ url: '/portal', label: 'Home' })}
              className="font-os-logo text-2xl font-semibold text-os-accent focus:outline-none"
            >
              dali.os
            </button>
          )}
          <Tooltip content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-os-grey transition-colors hover:bg-os-hover hover:text-foreground"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-[18px] w-[18px]" />
              ) : (
                <PanelLeftClose className="h-[18px] w-[18px]" />
              )}
            </button>
          </Tooltip>
        </div>

        {/* Search — the visible affordance for the ⌘K palette. */}
        <Tooltip content={collapsed ? 'Search (⌘K)' : ''} placement="right">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
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
        </Tooltip>

        {/* The four surfaces, as direct rows. */}
        <div className="flex shrink-0 flex-col gap-3">
          {PORTAL_NAV.map((item) => {
            const Icon = item.icon
            return (
              <Tooltip key={item.href} content={collapsed ? item.label : ''} placement="right">
                <button
                  type="button"
                  {...tabClickProps({ url: item.href, label: item.label })}
                  className={railRowClass(isPortalNavActive(path, item), collapsed)}
                >
                  <Icon className="h-5 w-5 flex-shrink-0 opacity-85" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              </Tooltip>
            )
          })}
        </div>
      </div>

      {/* User row — the foot of the rail, carrying the rows the design has no
          other home for (settings, log out). */}
      <div ref={userMenuRef} className="relative shrink-0 pt-6">
        {userMenuOpen && (
          <div
            role="menu"
            className={cn('absolute bottom-full left-0 mb-2 w-full min-w-[180px] motion-safe:animate-area-menu', osMenuClass)}
          >
            <button
              type="button"
              role="menuitem"
              {...tabClickProps({ url: '/portal/settings', label: 'Settings' })}
              className={osMenuItemClass}
            >
              <Settings className="h-4 w-4 flex-shrink-0 text-os-grey" />
              Settings
            </button>
            <a href="/logout" role="menuitem" className={osMenuItemClass}>
              <LogOut className="h-4 w-4 flex-shrink-0 text-os-grey" />
              Log out
            </a>
          </div>
        )}
        <Tooltip content={collapsed ? `${user.firstName ?? user.email} — account menu` : ''} placement="right">
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            // Named explicitly: collapsed, the row is just an avatar, and the
            // menu behind it is the only route to settings and logging out.
            aria-label={`${user.firstName ?? user.email} — account menu`}
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
        </Tooltip>
      </div>
    </div>
  )

  /* ---------------- Top bar ---------------- */

  // Nothing on the left: favourites are a member surface, and an empty strip
  // where the member shell has one would read as something broken.
  const topBar = (
    <div className="os-nav-edge-b flex items-center justify-end gap-4 border-l-2 border-os-bg bg-os-nav px-6 py-4">
      <div ref={bellRef} className="relative">
        <Tooltip content={`Notifications — ${taskCount} need${taskCount === 1 ? 's' : ''} your attention`}>
          <button
            type="button"
            onClick={toggleBellPanel}
            aria-haspopup="dialog"
            aria-expanded={!!bellPanel}
            aria-label={`Notifications — ${taskCount} need${taskCount === 1 ? 's' : ''} your attention`}
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
        </Tooltip>

        {bellPanel && (
          <div
            role="dialog"
            aria-label="Notifications"
            style={{
              top: bellPanel.top,
              right: bellPanel.right,
              maxHeight: `calc(100vh - ${Math.round(bellPanel.top) + 16}px)`,
            }}
            className={cn(
              'fixed z-50 hidden w-[22rem] flex-col overflow-y-auto md:flex motion-safe:animate-area-menu',
              osMenuClass,
            )}
          >
            {/* No "See all" — the browsable history lives at /notifications,
                which is a member route. The panel is the whole feed here. */}
            <AttentionPanel
              tasks={openTasks}
              notifications={feedItems}
              onOpen={(url, label) => {
                closeBellPanel()
                openInWorkspace({ url, label })
              }}
            />
          </div>
        )}
      </div>
    </div>
  )

  const sidebarWidth = collapsed ? 'w-[76px]' : 'w-[276px]'
  const mainPad = collapsed ? 'md:pl-[76px]' : 'md:pl-[276px]'

  return (
    <div
      className={cn(
        'os-shell flex min-h-screen min-h-dvh flex-col bg-os-bg pt-14 text-foreground md:flex-row md:pt-0',
        // A *definite* height, not just a floor, so a `fitViewport` page's own
        // scrollports do the scrolling instead of the window. Desktop only —
        // below `md` the shell goes mobile and those pages fall back to page
        // scroll, where capping would clip them.
        fitViewport && 'md:h-dvh md:overflow-hidden',
      )}
    >
      <aside
        className={cn(
          'os-nav-edge-r fixed inset-y-0 left-0 z-20 hidden flex-col bg-os-nav transition-[width] duration-200 md:flex',
          sidebarWidth,
        )}
      >
        {renderSidebar(collapsed)}
      </aside>

      {/* Mobile top bar */}
      <div className="os-nav-edge-b fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between bg-os-nav px-4 md:hidden">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="-ml-1.5 p-1.5 text-os-grey hover:text-foreground"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileNavOpen}
            aria-controls="os-portal-mobile-nav"
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <button
            type="button"
            {...tabClickProps({ url: '/portal', label: 'Home' })}
            className="font-os-logo text-xl font-semibold text-os-accent"
          >
            dali.os
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="p-1.5 text-os-grey hover:text-foreground"
            aria-label="Search (⌘K)"
            title="Search (⌘K)"
          >
            <Search className="h-5 w-5" />
          </button>
          <Link to="/portal/settings" aria-label="Settings" className="flex items-center">
            {avatar('h-8 w-8')}
          </Link>
        </div>
      </div>

      {/* Mobile drawer — force collapsed=false so it always shows full labels
          even when the desktop rail is in its icon-only state. */}
      {mobileNavOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-os-overlay md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside
            id="os-portal-mobile-nav"
            className="os-nav-edge-r fixed inset-y-0 left-0 z-40 flex w-[276px] flex-col bg-os-nav shadow-xl md:hidden"
          >
            {renderSidebar(false)}
          </aside>
        </>
      )}

      <main
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[padding] duration-200',
          fitViewport && 'min-h-0',
          mainPad,
        )}
      >
        {/* `shrink-0` so a bounded shell takes the height out of the page's own
            scrollport rather than squashing the bar. */}
        <div className="hidden shrink-0 md:block">{topBar}</div>
        <div className={cn('flex flex-1 flex-col overflow-x-hidden', fitViewport && 'min-h-0')}>
          {children}
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        tabless
        focusMode={false}
        portalNav={PORTAL_NAV}
        onOpen={openFromPalette}
      />
    </div>
  )
}
