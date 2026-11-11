import React, { useState, useEffect, useRef, useCallback } from 'react'
import { TOGGLE_SIDEBAR_SHORTCUT } from '~/lib/shortcuts'
import { useToggleSidebarShortcut } from '~/components/shell/useToggleSidebarShortcut'
import { Link, useLocation, useNavigation } from 'react-router'
import { Tooltip } from "~/components/ui/floating";
import { ArrowRight, Bell, Menu, PanelLeft, Search, X } from 'lucide-react'
import type { FavoritePage } from '~/lib/user-pages.server'
import { userInitials } from '~/lib/display'
import { useAttentionFeed } from '~/components/NotificationBell'
import { TasksDrawer, attentionTotal } from '~/components/AttentionPanel'
import { DesktopBanner } from '~/components/DesktopBanner'
import { OpenInDesktopRedirect } from '~/components/shell/OpenInDesktopRedirect'
import { useOpenCurrentPageInDesktop } from '~/components/shell/useOpenCurrentPageInDesktop'
import { useIsBrowserDesktopCandidate } from '~/lib/desktop-candidate'
import { useDesktopHint } from '~/components/shell/useDesktopHint'
import { ImpersonationBanner } from '~/components/ImpersonationBanner'
import { ActivityLauncher } from '~/components/activities/ActivityLauncher'
import { CommandPalette } from '~/components/CommandPalette'
import { FeedbackButton } from '~/components/feedback/FeedbackButton'
import {
  useRecordTablessHistory,
  useShowTablessHistoryNav,
  useTablessHistoryShortcuts,
} from '~/components/TablessHistoryNav'
import { useShellNav } from '~/components/shell-nav'
import { DesktopTabStrip, useDesktopTabs } from '~/components/DesktopTabs'
import { TabsShowingProvider } from '~/components/shell/TabKeepAlive'
import { tabActions } from '~/lib/desktop-tabs-store'
import type { DesktopTabsState } from '~/lib/desktop-tabs'
import { buildPageLink, cleanTabUrl, COPY_PAGE_LINK_EVENT, stripHash, writePageLink } from '~/lib/page-link'
import { useToast } from '~/components/ui/toast'
import { TOGGLE_FAVORITE_EVENT, useCurrentPageFavorite } from '~/components/favorites-live'
import { setFocusPreference } from '~/lib/focus-mode'
import { useOsShellRoot } from '~/lib/os-shell'
import { cn } from '~/lib/cn'
import {
  areaForPath,
  areaInk,
  areaTint,
  pinnedNavItems,
  homeNavItem,
  shellPageIcon,
  activeSubtabHref,
  visibleAreas,
  visibleSubtabs,
  type NavArea,
  type RoleFlags,
} from '~/lib/nav-areas'
import { useOpenAsk } from '~/ask/components/use-ask'
import { useFeatureFlag } from '~/components/FeatureFlags'
import { useAdminAttention } from '~/admin/useAdminAttention'
import { useEmailUnread } from '~/email/lib/use-email-unread'
import { Rail } from '~/components/shell/Rail'
import { useUpcomingMeetings } from '~/components/shell/RailUpcoming'
import { RailEdgeHandle } from '~/components/shell/RailEdgeHandle'
import { userMenuEntries } from '~/components/shell/rail-model'
import { PageBar } from '~/components/shell/PageBar'
import { DockedNavigationProgress } from '~/components/NavigationProgress'
import { PageBarSlotProvider, useShellHeaderHeight } from '~/components/shell/page-bar-slot'

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
  isAlumni?: boolean
  isNewMember?: boolean
  /** Starred pages/routes, most-recently pinned first — carried by the top bar. */
  favorites?: FavoritePage[]
  /** Receives local reorders of `favorites` (drag, Move left/right, Remove). */
  onFavoritesChange?: (next: FavoritePage[]) => void
  /** True when this session is an admin "log in as" — shows the exit banner. */
  impersonating?: boolean
  impersonationAllowsWrites?: boolean
  focusMode?: boolean
  /** A published release note the viewer can see is newer than their last visit. */
  hasUnseenReleaseNotes?: boolean
  desktopHintDismissed?: boolean
  /** The routed page fills the shell's main column instead of growing past it
   *  (see `handle.fitViewport`) — the shell is then bounded to the window and
   *  the page scrolls inside its own panes. */
  fitViewport?: boolean
  /** The server's guess that this window shows desktop tabs (strip cookie), so
   *  the strip's row is there on first paint. */
  tabStripHint?: boolean
  /** The open tabs as the server last saw them, so the strip paints with them. */
  tabsSnapshot?: DesktopTabsState | null
  children: React.ReactNode
}

const LAST_AREA_KEY = 'dali:sidebar:area'

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
  isAlumni = false,
  isNewMember = false,
  favorites = [],
  onFavoritesChange,
  impersonating = false,
  impersonationAllowsWrites = false,
  focusMode = false,
  hasUnseenReleaseNotes = false,
  desktopHintDismissed = false,
  fitViewport = false,
  tabStripHint = false,
  tabsSnapshot = null,
  children,
}: LayoutOSProps) {
  const location = useLocation()
  const showTabs = useDesktopTabs(true, tabStripHint, impersonating)
  // The rail is full width or hidden, nothing in between; collapsing it
  // (button, edge, ⌘\) hides it entirely, leaving only the expand button in
  // the tab strip / page bar.
  const [hideRail, setRailHidden] = useState(focusMode)
  const toggleRail = () => {
    setFocusPreference(!hideRail)
    setRailHidden(!hideRail)
  }
  useToggleSidebarShortcut(true, toggleRail)
  useRecordTablessHistory()
  useTablessHistoryShortcuts(useShowTablessHistoryNav(), showTabs)
  useOsShellRoot(true)
  const shellHeaderRef = useShellHeaderHeight()

  const { paletteOpen, setPaletteOpen, openInWorkspace, openFromPalette, tabClickProps } =
    useShellNav({ tabs: showTabs, sidePanel: true })

  const toast = useToast()

  const copyCurrentPageLink = useCallback(
    async (opts: { native?: boolean; url?: string } = {}) => {
      const url = opts.url ?? buildPageLink(window.location, window.location.origin)
      if (await writePageLink(url, opts)) toast.success('Link copied')
      else toast.error(<span>Couldn&apos;t copy. {url}</span>)
    },
    [toast],
  )

  useEffect(() => {
    const onCopy = (e: Event) => {
      const detail = (e as CustomEvent<{ native?: boolean; url?: string } | undefined>).detail
      void copyCurrentPageLink({ native: detail?.native === true, url: detail?.url })
    }
    window.addEventListener(COPY_PAGE_LINK_EVENT, onCopy)
    return () => window.removeEventListener(COPY_PAGE_LINK_EVENT, onCopy)
  }, [copyCurrentPageLink])
  const starUrl = stripHash(cleanTabUrl(location.pathname + location.search))
  // Titles are "<page> · DALI OS"; keep the page part.
  const starLabel =
    (typeof document !== 'undefined' ? document.title.split(' · ')[0] : '') || starUrl || ''
  const pageStar = useCurrentPageFavorite(starUrl, starLabel, true)
  const toggleStarRef = useRef(pageStar)
  toggleStarRef.current = pageStar

  useEffect(() => {
    const onToggle = (e: Event) => {
      e.preventDefault()
      if (toggleStarRef.current.canToggle) void toggleStarRef.current.toggle()
    }
    window.addEventListener(TOGGLE_FAVORITE_EVENT, onToggle)
    return () => window.removeEventListener(TOGGLE_FAVORITE_EVENT, onToggle)
  }, [])

  // The live url, query included — the nav matchers trim it themselves, but they
  // need the query to tell a Core deep-link into the Drive (/drive?type=agreement)
  // from the plain Drive pin, and location.pathname alone would drop it.
  // While a navigation is loading, the destination wins: the sidebar highlights
  // where you're headed at click time, so its morph and slide animations run
  // during the fetch instead of competing with the new page's render.
  const navigation = useNavigation()
  const pendingPath =
    navigation.state === 'loading' && navigation.location
      ? navigation.location.pathname + navigation.location.search
      : null
  const path = pendingPath ?? location.pathname + location.search
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [lastAreaKey, setLastAreaKey] = useState('projects')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedArea = window.localStorage.getItem(LAST_AREA_KEY)
    if (savedArea) setLastAreaKey(savedArea)
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [path])

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
    isAlumni,
    isNewMember,
  }
  // The `community` flag adds the Community area and moves Community into it, so
  // every nav matcher below has to be handed the same map.
  const navFlags = {
    community: useFeatureFlag('community'),
    'onboarding-journeys': useFeatureFlag('onboarding-journeys'),
    'refer-a-partner': useFeatureFlag('refer-a-partner'),
    'core-taskboard': useFeatureFlag('core-taskboard'),
  }
  const releaseNotesEnabled = useFeatureFlag('release-notes')
  const askEnabled = useFeatureFlag('ask-dali')
  const { openAsk } = useOpenAsk()
  const emailUnread = useEmailUnread(path)
  const areas = visibleAreas(roleFlags, navFlags)
  const routeArea = areaForPath(path, navFlags, roleFlags)
  const pinned = pinnedNavItems(roleFlags, navFlags)
  const home = homeNavItem(roleFlags)
  const activeArea = routeArea ?? areas.find((a) => a.key === lastAreaKey) ?? areas[0]
  // Calendar, email and drive have no area of their own, so their page accent
  // follows the rail's selected mode (home keeps the default accent).
  const accentArea =
    routeArea ??
    (['/calendar', '/email', '/drive'].some((p) => path.startsWith(p)) ? activeArea : undefined)
  const adminAttention = useAdminAttention(activeArea?.key === 'admin', path)
  const activeSubtabs = activeArea ? visibleSubtabs(activeArea, roleFlags) : []
  const activeHref = activeArea ? activeSubtabHref(activeArea, path) : undefined
  // Nothing to switch to, so the area's sub-tabs join the pinned list.
  const singleArea = areas.length === 1

  const routeAreaKey = routeArea?.key
  useEffect(() => {
    if (!routeAreaKey) return
    setLastAreaKey(routeAreaKey)
    if (typeof window !== 'undefined') window.localStorage.setItem(LAST_AREA_KEY, routeAreaKey)
  }, [routeAreaKey])

  const selectArea = (area: NavArea, e: React.MouseEvent) => {
    setLastAreaKey(area.key)
    if (typeof window !== 'undefined') window.localStorage.setItem(LAST_AREA_KEY, area.key)
    tabClickProps({ url: area.hubPath, label: area.label }).onClick(e)
  }

  const initials = userInitials(user)
  const { tasks: openTasks, items: feedItems, projectTasks, totals: feedTotals } = useAttentionFeed()
  const taskCount = attentionTotal(openTasks, feedItems, projectTasks, feedTotals)
  const upcoming = useUpcomingMeetings(true)

  /* ---------------- Tasks drawer (bell, top bar) ---------------- */
  // The bell owns the attention stack that used to be a banner on Home: open
  // tasks and unanswered invites, with their RSVP / Confirm / Dismiss controls
  // rendered inline (see TasksDrawer), plus assigned project work.
  const [bellOpen, setBellOpen] = useState(false)
  const closeBellPanel = useCallback(() => setBellOpen(false), [])
  const seeAllProps = tabClickProps({ url: '/notifications', label: 'My Tasks' })

  /* ---------------- Rail ---------------- */

  const avatar = (size: string) =>
    photoUrl ? (
      <img src={photoUrl} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    ) : (
      <span
        className={`${size} flex shrink-0 items-center justify-center rounded-full bg-os-container text-[10px] font-bold text-foreground`}
      >
        {initials}
      </span>
    )

  const browserDesktop = useIsBrowserDesktopCandidate()
  const openCurrentPageInDesktop = useOpenCurrentPageInDesktop()
  useDesktopHint({ enabled: browserDesktop, dismissed: desktopHintDismissed })
  const userMenuItems = userMenuEntries({
    releaseNotes: releaseNotesEnabled,
    desktopDownload: browserDesktop,
  })
  const onReleaseNotes = path.startsWith('/release-notes')
  // The layout loader rarely revalidates, so its flag stays stale after a visit.
  const [visitedReleaseNotes, setVisitedReleaseNotes] = useState(onReleaseNotes)
  useEffect(() => {
    if (onReleaseNotes) setVisitedReleaseNotes(true)
  }, [onReleaseNotes])
  const showWhatsNewDot = hasUnseenReleaseNotes && !onReleaseNotes && !visitedReleaseNotes

  const tasksDrawer = (
    <TasksDrawer
      open={bellOpen}
      onClose={closeBellPanel}
      tasks={openTasks}
      notifications={feedItems}
      projectTasks={projectTasks}
      totals={feedTotals}
      singleFeed={isAlumni}
      onOpen={(url, label) => {
        closeBellPanel()
        openInWorkspace({ url, label })
      }}
      seeAll={
        // Close after opening, in the same handler. Closing on capture
        // flushed the state update before the bubble phase, unmounting
        // this button so its navigation never ran.
        <button
          type="button"
          {...seeAllProps}
          onClick={(e) => {
            seeAllProps.onClick(e)
            closeBellPanel()
          }}
          className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-semibold text-os-accent hover:bg-os-container"
        >
          See all
          <ArrowRight strokeWidth={1.5} className="h-[15px] w-[15px]" aria-hidden />
        </button>
      }
    />
  )

  const railToggle = (
    <Tooltip content={`Show sidebar · ${TOGGLE_SIDEBAR_SHORTCUT}`}>
      <button
        type="button"
        onClick={toggleRail}
        aria-label="Show sidebar"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-os-grey transition-colors hover:bg-os-hover hover:text-foreground"
      >
        <PanelLeft strokeWidth={1.5} className="h-[18px] w-[18px]" />
      </button>
    </Tooltip>
  )

  const renderRail = (hideable: boolean) => (
    <Rail
      userName={[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}
      initials={initials}
      photoUrl={photoUrl}
      path={path}
      navFlags={navFlags}
      isAlumni={isAlumni}
      isNewMember={isNewMember}
      home={home}
      pinned={pinned}
      tabClickProps={tabClickProps}
      emailUnread={emailUnread}
      taskCount={taskCount}
      bellOpen={bellOpen}
      onToggleBell={() => setBellOpen((o) => !o)}
      onOpenSearch={() => setPaletteOpen(true)}
      onHideRail={hideable ? toggleRail : undefined}
      size="expanded"
      animated={hideable}
      favorites={favorites}
      onFavoritesChange={onFavoritesChange}
      favoritesActiveHref={stripHash(cleanTabUrl(location.pathname + location.search))}
      upcoming={upcoming}
      areas={areas}
      activeArea={activeArea}
      activeSubtabs={activeSubtabs}
      activeHref={activeHref}
      onSelectArea={selectArea}
      userMenuItems={userMenuItems}
      showWhatsNewDot={showWhatsNewDot}
      topInset={!showTabs}
    />
  )

  return (
    <div
      // `--area` carries the active section's accent: the rail's active row,
      // its icons and the section switcher all tint from it. Both halves of
      // the tone go up; app.css resolves `--area` per mode (tint on the dark
      // nav, ink on light — the tints are too pale to read on white).
      style={
        {
          '--area-tint': areaTint(activeArea?.key),
          '--area-ink': areaInk(activeArea?.key),
          // The page accent (--color-os-accent resolves from these) follows the
          // page's own mode. Keyed on accentArea: the page's
          // own area, or the rail's selected mode on the shared pages
          // (calendar, email, drive); home keeps the default accent.
          ...(accentArea
            ? {
                '--mode-accent': areaTint(accentArea.key),
                '--mode-accent-hover': `color-mix(in srgb, ${areaTint(accentArea.key)} 78%, white)`,
                '--mode-accent-ink': areaInk(accentArea.key),
                '--mode-accent-ink-hover': `color-mix(in srgb, ${areaInk(accentArea.key)} 82%, black)`,
              }
            : {}),
        } as React.CSSProperties
      }
      className={cn(
        'os-shell flex min-h-screen min-h-dvh flex-col bg-os-bg pt-14 text-foreground md:flex-row md:pt-0',
        // `min-h-dvh` alone is a floor, so a page taller than the window still
        // grows the document — every `min-h-0`/`flex-1` below here can only
        // shrink against a *definite* height. A `fitViewport` page gets one, so
        // its own scrollports do the scrolling instead of the window. Desktop
        // only: below `md` — the same breakpoint this shell goes mobile at —
        // those pages fall back to page scroll (the calendar's hour grid doesn't
        // scroll internally there), and capping would clip it.
        fitViewport && 'md:h-dvh md:overflow-hidden',
      )}
    >
      {!hideRail && (
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-[264px] flex-col border-r border-os-container bg-os-nav md:flex">
          <div className="os-rail-scale h-full">{renderRail(true)}</div>
          <RailEdgeHandle onToggle={toggleRail} />
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
            {...tabClickProps({ url: home.href, label: home.label })}
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
            {renderRail(false)}
          </aside>
        </>
      )}

      <PageBarSlotProvider>
      <main
        className={cn(
          'flex min-w-0 flex-1 flex-col',
          'transition-[padding] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
          fitViewport && 'min-h-0',
          !hideRail && 'md:pl-[264px]',
        )}
      >
        {/* Impersonation is a session-mode indicator, so it sits above the top
            bar and shows even in focus mode. */}
        {impersonating && (
          <ImpersonationBanner allowsWrites={impersonationAllowsWrites}
            userName={`${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email}
          />
        )}
        {/* Sticky because the page bar carries the document toolbar, which used
            to stick on its own (.doc-topbar). */}
        <div ref={shellHeaderRef} className="relative sticky top-14 z-20 shrink-0 bg-os-bg md:top-0">
          {showTabs && (
            <div className="hidden md:block">
              <DesktopTabStrip leading={hideRail ? railToggle : undefined} initial={tabsSnapshot} />
            </div>
          )}
          <PageBar
            tabs={showTabs}
            leading={
              hideRail && !showTabs ? <div className="hidden md:block">{railToggle}</div> : undefined
            }
            areaKey={accentArea?.key}
            icon={routeArea ? undefined : shellPageIcon(path, home.href)}
            star={pageStar}
            onCopyLink={() => void copyCurrentPageLink()}
          />
          {showTabs && <DockedNavigationProgress />}
        </div>
        {tasksDrawer}
        <DesktopBanner />
        <ActivityLauncher />
        <div
          className="flex min-h-0 flex-1 flex-col"
          // A press or keystroke in a preview tab's page is real engagement:
          // keep the tab, so the next sidebar click can't replace it.
          onPointerDownCapture={showTabs ? tabActions.promoteActive : undefined}
          onKeyDownCapture={showTabs ? tabActions.promoteActive : undefined}
        >
          <TabsShowingProvider value={showTabs}>{children}</TabsShowingProvider>
        </div>
      </main>
      </PageBarSlotProvider>

      <FeedbackButton
        pagePath={path}
        onOpenFeed={() => openInWorkspace({ url: '/feedback', label: 'Feedback' })}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        focusMode={hideRail}
        roles={roleFlags}
        flags={navFlags}
        onOpen={openFromPalette}
        onOpenInDesktop={browserDesktop ? openCurrentPageInDesktop : undefined}
        onAsk={askEnabled ? openAsk : undefined}
      />
      <OpenInDesktopRedirect />
    </div>
  )
}
