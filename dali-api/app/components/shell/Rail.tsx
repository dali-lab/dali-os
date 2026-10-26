import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { TOGGLE_SIDEBAR_SHORTCUT } from '~/lib/shortcuts'
import {
  Bell,
  Calendar,
  Check,
  ChevronsUpDown,
  LogOut,
  Mail,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip } from '~/components/ui/floating'
import { cn } from '~/lib/cn'
import { FavoritesBar } from '~/components/FavoritesBar'
import { osMenuClass, osMenuItemClass, useAccountMenuStyle } from '~/components/os-shell-chrome'
import { AreaTile } from '~/components/shell/AreaTile'
import { activeQuickItem, badgeLabel, orderRailAreas, type SidebarSize } from '~/components/shell/rail-model'
import type { NavArea, SubTab } from '~/lib/nav-areas'
import type { FeatureFlagMap } from '~/lib/feature-flags'
import type { FavoritePage } from '~/lib/user-pages.server'
import type { OpenTabRequest } from '~/components/TabWorkspace'

type TabClickProps = (req: OpenTabRequest) => Record<string, unknown>

export type RailUserMenuItem = { url: string; label: string; icon: LucideIcon }

export type RailProps = {
  userName: string
  initials: string
  photoUrl?: string | null
  path: string
  navFlags: Partial<FeatureFlagMap>
  isAlumni: boolean
  isNewMember?: boolean
  home: SubTab
  pinned: SubTab[]
  tabClickProps: TabClickProps
  emailUnread: number
  taskCount: number
  bellOpen: boolean
  onToggleBell: () => void
  onOpenSearch: () => void
  onHideRail?: () => void
  /** Scalable rail: 'compact' narrows the rail to an icon column. */
  size?: SidebarSize
  /** Scalable rail: the header toggle scales the rail instead of hiding it. */
  onToggleSize?: () => void
  /** Entrance animations (section-change stagger, label fades). */
  animated?: boolean
  /** The CSS zoom applied around this rail (see `.os-rail-zoom`); the rail's
      fixed-position menus divide their measured coordinates by it. */
  zoom?: number
  favorites: FavoritePage[]
  onFavoritesChange?: (next: FavoritePage[]) => void
  favoritesActiveHref: string | null
  areas: NavArea[]
  activeArea: NavArea | undefined
  activeSubtabs: SubTab[]
  activeHref: string | undefined
  onSelectArea: (area: NavArea, e: ReactMouseEvent) => void
  userMenuItems: RailUserMenuItem[]
  showWhatsNewDot: boolean
  topInset?: boolean
}

const ICON_BUTTON =
  'group relative flex shrink-0 items-center justify-center rounded-md text-os-grey outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-os-hover hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-os-accent/60'
const ICON_MOTION = 'transition-transform duration-150 ease-out'

function QuickItem({
  label,
  icon: Icon,
  active,
  tooltip,
  dot,
  compact,
  tabProps,
}: {
  label: string
  icon: LucideIcon
  active: boolean
  tooltip?: string
  dot?: boolean
  compact: boolean
  tabProps: Record<string, unknown>
}) {
  const showLabel = active && !compact
  const button = (
    <button
      type="button"
      {...tabProps}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex shrink-0 items-center rounded-lg outline-none transition-[background-color,color,transform] duration-150 ease-out active:scale-95 focus-visible:ring-2 focus-visible:ring-os-accent/60',
        compact ? 'h-9 w-9 justify-center' : 'h-8 px-[9px]',
        active ? 'bg-os-hover-strong text-sm font-medium text-foreground' : 'text-os-grey hover:bg-os-hover hover:text-foreground',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', ICON_MOTION, 'group-hover:scale-110')} aria-hidden />
      {/* Always mounted so the pill can morph open and closed. The 0fr↔1fr
          grid track animates to the label's exact width — a max-width tween
          overshoots and reads as a pause, then a snap. */}
      {!compact && (
        <span
          aria-hidden
          className={cn(
            'grid transition-[grid-template-columns,margin,opacity] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            showLabel ? 'ml-2 grid-cols-[1fr] opacity-100' : 'ml-0 grid-cols-[0fr] opacity-0',
          )}
        >
          <span className="min-w-0 overflow-hidden whitespace-nowrap">{label}</span>
        </span>
      )}
      {dot && <span className="absolute right-[7px] top-[6px] h-[7px] w-[7px] rounded-full bg-os-accent ring-2 ring-os-nav" aria-hidden />}
    </button>
  )
  // Always the same tree shape: toggling the wrapper with the active state
  // would remount the button and skip the morph transition.
  return (
    <Tooltip content={tooltip ?? label} placement={compact ? 'right' : 'top'} disabled={showLabel}>
      {button}
    </Tooltip>
  )
}

export function Rail({
  userName,
  initials,
  photoUrl,
  path,
  navFlags,
  isAlumni,
  isNewMember = false,
  home,
  pinned,
  tabClickProps,
  emailUnread,
  taskCount,
  bellOpen,
  onToggleBell,
  onOpenSearch,
  onHideRail,
  size = 'expanded',
  onToggleSize,
  animated = false,
  zoom = 1,
  favorites,
  onFavoritesChange,
  favoritesActiveHref,
  areas,
  activeArea,
  activeSubtabs,
  activeHref,
  onSelectArea,
  userMenuItems,
  showWhatsNewDot,
  topInset = false,
}: RailProps) {
  const compact = size === 'compact'
  const activeQuick = activeQuickItem(path, {
    home: home.href,
    pinned,
    flags: navFlags,
    roles: { isAlumni, isNewMember },
  })
  const singleArea = areas.length === 1
  const orderedAreas = orderRailAreas(areas)

  const [areaMenuOpen, setAreaMenuOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const areaMenuRef = useRef<HTMLDivElement | null>(null)
  const areaTriggerRef = useRef<HTMLButtonElement | null>(null)
  const userMenuRef = useRef<HTMLDivElement | null>(null)
  const userMenuStyle = useAccountMenuStyle(userMenuRef, userMenuOpen, compact ? 'right' : 'up', zoom)
  const [areaMenuRect, setAreaMenuRect] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    setAreaMenuOpen(false)
    setUserMenuOpen(false)
  }, [path])

  useEffect(() => {
    setAreaMenuOpen(false)
    setUserMenuOpen(false)
  }, [compact])

  // The menus are fixed-position inside the rail's scroller, so a plain
  // overlay would cover them and swallow option clicks.
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

  const measureAreaMenu = useCallback(() => {
    const rect = areaTriggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAreaMenuRect(
      compact
        ? { top: rect.top / zoom, left: (rect.right + 8) / zoom, width: 264 / zoom }
        : { top: (rect.bottom + 6) / zoom, left: rect.left / zoom, width: rect.width / zoom },
    )
  }, [compact, zoom])

  const toggleAreaMenu = useCallback(() => {
    setAreaMenuOpen((v) => {
      if (!v) measureAreaMenu()
      return !v
    })
  }, [measureAreaMenu])

  useEffect(() => {
    if (!areaMenuOpen) return
    window.addEventListener('resize', measureAreaMenu)
    window.addEventListener('scroll', measureAreaMenu, true)
    return () => {
      window.removeEventListener('resize', measureAreaMenu)
      window.removeEventListener('scroll', measureAreaMenu, true)
    }
  }, [areaMenuOpen, measureAreaMenu])

  // The active row's fill is one element shared by the list, positioned over
  // the active row, so a change of page slides it there instead of repainting.
  // Only the vertical position is measured: a measured pixel width goes stale
  // against the list's own scrollbar and spills into horizontal scroll.
  const subtabListRef = useRef<HTMLDivElement | null>(null)
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null)
  const areaKey = activeArea?.key
  useLayoutEffect(() => {
    const list = subtabListRef.current
    const row = list?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!list || !row) {
      setPill(null)
      return
    }
    setPill({ top: row.offsetTop, height: row.offsetHeight })
  }, [activeHref, compact, areaKey, activeSubtabs, areaMenuOpen])

  // Entrance animations replay on a section change, never on first paint: the
  // rows carry the animation class only once the shown area differs from the
  // mounted one, and the list remounts (keyed by area) to restart it.
  const firstAreaRef = useRef(areaKey)
  const staggered = animated && areaKey !== undefined && firstAreaRef.current !== areaKey

  const bellLabel = `Notifications, ${taskCount} need${taskCount === 1 ? 's' : ''} your attention`

  const logo = (
    <button
      type="button"
      {...tabClickProps({ url: home.href, label: home.label })}
      aria-label="DALI OS home"
      className={cn(
        // The wordmark wears the active section's color (--area), so entering
        // Education turns it yellow, Core coral, and so on.
        'group flex h-9 shrink-0 items-center rounded-lg font-os-logo text-xl font-semibold text-[var(--area,var(--color-os-accent))] transition-colors duration-150 hover:text-[color-mix(in_srgb,var(--area,var(--color-os-accent))_80%,white)] focus:outline-none',
        compact ? 'w-9 justify-center' : 'pl-1.5 pr-2',
      )}
    >
      {compact ? 'd' : 'dali'}
      <span className={cn('inline-block', ICON_MOTION, 'group-hover:-translate-y-1')}>.</span>
      {!compact && 'os'}
    </button>
  )

  const bellButton = (
    <Tooltip content={bellLabel} placement={compact ? 'right' : 'top'}>
      <button
        type="button"
        onClick={onToggleBell}
        aria-haspopup="dialog"
        aria-expanded={bellOpen}
        aria-label={bellLabel}
        className={cn(ICON_BUTTON, compact ? 'h-9 w-9' : 'h-[30px] w-[30px]')}
      >
        <Bell className={cn('h-[18px] w-[18px]', ICON_MOTION, 'group-hover:scale-110')} />
        {taskCount > 0 && (
          <span className="absolute right-px top-0.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-[var(--os-danger-ink)] px-[3px] text-[9px] font-extrabold leading-none text-white">
            {badgeLabel(taskCount)}
          </span>
        )}
      </button>
    </Tooltip>
  )

  const toggleButton = onToggleSize ? (
    <Tooltip
      content={`${compact ? 'Expand' : 'Collapse'} sidebar · ${TOGGLE_SIDEBAR_SHORTCUT}`}
      placement={compact ? 'right' : 'top'}
    >
      <button
        type="button"
        onClick={onToggleSize}
        aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(ICON_BUTTON, compact ? 'h-9 w-9' : 'h-7 w-7')}
      >
        {compact ? (
          <PanelLeftOpen className={cn('h-[18px] w-[18px]', ICON_MOTION, 'group-hover:translate-x-0.5')} />
        ) : (
          <PanelLeftClose className={cn('h-[18px] w-[18px]', ICON_MOTION, 'group-hover:-translate-x-0.5')} />
        )}
      </button>
    </Tooltip>
  ) : onHideRail ? (
    <Tooltip content={`Hide sidebar · ${TOGGLE_SIDEBAR_SHORTCUT}`}>
      <button type="button" onClick={onHideRail} aria-label="Hide sidebar" className={cn(ICON_BUTTON, 'h-7 w-7')}>
        <PanelLeft className="h-[18px] w-[18px]" />
      </button>
    </Tooltip>
  ) : null

  return (
    <div
      data-sidebar-scroll
      className="flex h-full flex-col justify-between gap-3 overflow-y-auto overflow-x-hidden px-3 pb-3"
    >
      <div className="flex min-h-0 flex-col gap-3">
        {compact ? (
          <div className={cn('flex shrink-0 flex-col items-center gap-1', topInset ? 'pt-2.5' : 'pt-1')}>
            {logo}
            {toggleButton}
            {bellButton}
          </div>
        ) : (
          <div className={cn('flex shrink-0 items-center justify-between', topInset ? 'h-[50px] pt-2.5' : 'h-10')}>
            {logo}
            <div className="flex items-center gap-0.5">
              {bellButton}
              {toggleButton}
            </div>
          </div>
        )}

        <Tooltip content="Search · ⌘K" disabled={!compact} placement="right">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search"
            className={cn(
              'group flex shrink-0 items-center rounded-lg border border-os-container bg-os-card text-sm text-os-grey outline-none transition-[background-color,border-color,color,transform] duration-150 ease-out hover:border-os-container-hi hover:bg-os-card-hover hover:text-foreground active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-os-accent/60',
              compact ? 'mx-auto h-9 w-9 justify-center' : 'h-9 w-full gap-2.5 pl-[13px] pr-1.5',
            )}
          >
            <Search className={cn('h-4 w-4 shrink-0', ICON_MOTION, 'group-hover:scale-110')} aria-hidden />
            {!compact && (
              <>
                <span className="whitespace-nowrap">Search</span>
                <kbd className="ml-auto rounded-[5px] bg-os-hover-strong px-1.5 py-0.5 font-sans text-xs font-bold text-os-grey">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </Tooltip>

        {/* No Home quick item: the wordmark is the home button. */}
        <div className={cn('flex shrink-0 gap-1', compact && 'flex-col items-center')}>
          <QuickItem
            label="Calendar"
            icon={Calendar}
            active={activeQuick === 'calendar'}
            compact={compact}
            tabProps={tabClickProps({ url: '/calendar', label: 'Calendar' })}
          />
          {!isAlumni && (
            <QuickItem
              label="Email"
              icon={Mail}
              active={activeQuick === 'email'}
              tooltip={emailUnread > 0 ? `Email · ${emailUnread} unread` : 'Email'}
              dot={emailUnread > 0}
              compact={compact}
              tabProps={tabClickProps({ url: '/email', label: 'Email' })}
            />
          )}
          {pinned.map((item) => (
            <QuickItem
              key={item.href}
              label={item.label}
              icon={item.icon}
              active={activeQuick === item.href}
              compact={compact}
              tabProps={tabClickProps({ url: item.href, label: item.label })}
            />
          ))}
        </div>

        {!compact && favorites.length > 0 && onFavoritesChange && (
          <div className="shrink-0">
            <FavoritesBar
              orientation="vertical"
              favorites={favorites}
              onChange={onFavoritesChange}
              tabClickProps={tabClickProps}
              activeHref={favoritesActiveHref ?? undefined}
            />
          </div>
        )}

        {activeArea && (
          <>
            <div className="h-px shrink-0 bg-os-container" role="separator" />
            <div className="flex min-h-0 flex-col gap-2">
              <div ref={areaMenuRef} className={cn('shrink-0', compact && 'flex justify-center')}>
                {singleArea ? (
                  compact ? (
                    <Tooltip content={activeArea.label} placement="right">
                      <span className="flex h-9 w-9 items-center justify-center">
                        <AreaTile areaKey={activeArea.key} size={22} icon={activeArea.icon} />
                      </span>
                    </Tooltip>
                  ) : (
                    <p className="flex h-9 items-center gap-2.5 pl-2 text-sm font-semibold text-foreground">
                      <AreaTile areaKey={activeArea.key} size={22} icon={activeArea.icon} />
                      {activeArea.label}
                    </p>
                  )
                ) : (
                  <Tooltip
                    content={`${activeArea.label} · switch section`}
                    disabled={!compact || areaMenuOpen}
                    placement="right"
                  >
                    <button
                      type="button"
                      onClick={toggleAreaMenu}
                      aria-haspopup="listbox"
                      aria-expanded={areaMenuOpen}
                      aria-label={`Section: ${activeArea.label}. Switch section`}
                      ref={areaTriggerRef}
                      className={cn(
                        'group flex h-9 shrink-0 items-center rounded-lg border text-left text-sm font-semibold text-foreground outline-none transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-os-accent/60',
                        compact ? 'w-9 justify-center' : 'w-full gap-2.5 pl-[9px] pr-2',
                        'bg-[color-mix(in_srgb,var(--area)_9%,var(--color-os-card))] hover:bg-[color-mix(in_srgb,var(--area)_15%,var(--color-os-card))]',
                        areaMenuOpen
                          ? 'border-[color-mix(in_srgb,var(--area)_60%,transparent)]'
                          : 'border-[color-mix(in_srgb,var(--area)_30%,transparent)] hover:border-[color-mix(in_srgb,var(--area)_50%,transparent)]',
                      )}
                    >
                      <span className={cn('flex shrink-0', ICON_MOTION, 'group-hover:scale-105')}>
                        <AreaTile areaKey={activeArea.key} size={22} icon={activeArea.icon} />
                      </span>
                      {!compact && (
                        <>
                          <span className="truncate">{activeArea.label}</span>
                          <ChevronsUpDown
                            className="ml-auto h-3.5 w-3.5 shrink-0 text-os-muted transition-colors duration-150 group-hover:text-foreground"
                            aria-hidden
                          />
                        </>
                      )}
                    </button>
                  </Tooltip>
                )}
                {areaMenuOpen && areaMenuRect && (
                  <div
                    role="listbox"
                    style={{
                      top: areaMenuRect.top,
                      left: areaMenuRect.left,
                      width: areaMenuRect.width,
                      maxHeight: `calc(100vh - ${Math.round(areaMenuRect.top) + 16}px)`,
                    }}
                    className={cn('fixed z-40 overflow-y-auto motion-safe:animate-area-menu', osMenuClass)}
                  >
                    {orderedAreas.map((a) => {
                      const selected = a.key === activeArea.key
                      return (
                        <button
                          key={a.key}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={(e) => {
                            setAreaMenuOpen(false)
                            onSelectArea(a, e)
                          }}
                          className={cn(
                            'group flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm text-foreground transition-colors hover:bg-os-container',
                            selected && 'font-semibold',
                          )}
                        >
                          <span className={cn('flex shrink-0', ICON_MOTION, 'group-hover:scale-105')}>
                            <AreaTile areaKey={a.key} size={24} icon={a.icon} />
                          </span>
                          <span className="min-w-0 truncate">{a.label}</span>
                          {selected && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-os-accent" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {!areaMenuOpen && activeSubtabs.length > 0 && (
                <div
                  key={areaKey}
                  ref={subtabListRef}
                  className={cn(
                    'relative flex min-h-[5rem] flex-col gap-1.5 overflow-y-auto overflow-x-hidden',
                    compact && 'items-center',
                  )}
                >
                  {pill && (
                    <span
                      aria-hidden
                      style={pill}
                      className={cn(
                        'absolute rounded-lg bg-[color-mix(in_srgb,var(--area)_16%,transparent)]',
                        compact ? 'left-1/2 w-9 -translate-x-1/2' : 'inset-x-0',
                        animated &&
                          'transition-[top,height] duration-[220ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
                      )}
                    >
                      {!compact && (
                        <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--area)]" />
                      )}
                    </span>
                  )}
                  {activeSubtabs.map((t, i) => {
                    const active = t.href === activeHref
                    const row = (
                      <button
                        key={t.href}
                        type="button"
                        {...tabClickProps({ url: t.href, label: t.label })}
                        aria-current={active ? 'page' : undefined}
                        aria-label={compact ? t.label : undefined}
                        style={staggered ? { animationDelay: `${i * 30}ms` } : undefined}
                        className={cn(
                          'group relative flex shrink-0 items-center rounded-lg text-left text-sm outline-none transition-[color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-os-accent/60',
                          compact ? 'h-9 w-9 justify-center' : 'h-8 w-full gap-2.5 pl-[13px] pr-2',
                          staggered && 'motion-safe:animate-rail-stagger',
                          active ? 'font-semibold text-foreground' : 'text-os-grey hover:text-foreground',
                        )}
                      >
                        {!active && (
                          <span
                            className="absolute inset-0 rounded-lg bg-os-hover opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                            aria-hidden
                          />
                        )}
                        <t.icon
                          className={cn(
                            'relative h-[18px] w-[18px] shrink-0 transition-[transform,color] duration-150 ease-out',
                            active ? 'text-[var(--area)]' : 'group-hover:text-[var(--area)]',
                            !active && (compact ? 'group-hover:scale-110' : 'group-hover:translate-x-0.5'),
                          )}
                          aria-hidden
                        />
                        {!compact && (
                          <span className={cn('relative truncate whitespace-nowrap', animated && 'motion-safe:animate-rail-label')}>
                            {t.label}
                          </span>
                        )}
                      </button>
                    )
                    return compact ? (
                      <Tooltip key={t.href} content={t.label} placement="right">
                        {row}
                      </Tooltip>
                    ) : (
                      row
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 pt-2">
        <div className="h-px bg-os-container" role="separator" />
        <div ref={userMenuRef} className={cn('relative min-w-0', compact && 'flex justify-center')}>
          {userMenuStyle && (
            <div role="menu" style={userMenuStyle} className={cn('fixed z-40 motion-safe:animate-area-menu', osMenuClass)}>
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
                  {item.url === '/release-notes' && showWhatsNewDot && (
                    <span className="h-2 w-2 rounded-full bg-os-accent" role="img" aria-label="New entries" />
                  )}
                </button>
              ))}
              <a href="/logout" role="menuitem" className={osMenuItemClass}>
                <LogOut className="h-4 w-4 flex-shrink-0 text-os-grey" />
                Log out
              </a>
            </div>
          )}
          <Tooltip content={userName} disabled={!compact || userMenuOpen} placement="right">
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={`Account: ${userName}`}
              className={cn(
                'group flex shrink-0 items-center rounded-lg text-left outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-os-hover active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-os-accent/60',
                compact ? 'h-9 w-9 justify-center' : 'h-9 w-full gap-2.5 pl-[10px] pr-2',
                userMenuOpen && 'bg-os-hover',
              )}
            >
              <span className={cn('relative flex shrink-0', ICON_MOTION, 'group-hover:scale-105')}>
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-os-accent text-[10px] font-extrabold text-os-bg">
                    {initials}
                  </span>
                )}
                {showWhatsNewDot && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-os-accent ring-2 ring-os-nav" aria-hidden />
                )}
              </span>
              {!compact && (
                <>
                  <span className="truncate text-sm font-semibold text-foreground">{userName}</span>
                  <ChevronsUpDown
                    className="ml-auto h-3.5 w-3.5 shrink-0 text-os-muted transition-colors duration-150 group-hover:text-foreground"
                    aria-hidden
                  />
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
