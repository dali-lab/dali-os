import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronsUpDown,
  HelpCircle,
  Home,
  LogOut,
  Mail,
  PanelLeft,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip } from '~/components/ui/floating'
import { cn } from '~/lib/cn'
import { FavoritesBar } from '~/components/FavoritesBar'
import { osMenuClass, osMenuItemClass, useAccountMenuStyle } from '~/components/os-shell-chrome'
import { AreaTile } from '~/components/shell/AreaTile'
import { activeQuickItem, badgeLabel, orderRailAreas } from '~/components/shell/rail-model'
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

const ROW = 'flex h-8 w-full items-center gap-2.5 rounded-lg pl-2.5 pr-2 text-left text-sm transition-colors'
const ICON_BUTTON =
  'relative flex shrink-0 items-center justify-center rounded-md text-os-grey transition-colors hover:bg-os-hover hover:text-foreground'

function QuickItem({
  label,
  icon: Icon,
  active,
  tooltip,
  dot,
  tabProps,
}: {
  label: string
  icon: LucideIcon
  active: boolean
  tooltip?: string
  dot?: boolean
  tabProps: Record<string, unknown>
}) {
  const button = (
    <button
      type="button"
      {...tabProps}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-[34px] shrink-0 items-center rounded-lg transition-colors',
        active
          ? 'gap-2 bg-os-hover-strong pl-2.5 pr-3 text-sm font-medium text-foreground'
          : 'w-9 justify-center text-os-grey hover:bg-os-hover hover:text-foreground',
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {active && <span>{label}</span>}
      {dot && <span className="absolute right-[7px] top-[7px] h-[7px] w-[7px] rounded-full bg-os-accent" aria-hidden />}
    </button>
  )
  if (active) return button
  return <Tooltip content={tooltip ?? label}>{button}</Tooltip>
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
  const userMenuStyle = useAccountMenuStyle(userMenuRef, userMenuOpen)
  const [areaMenuRect, setAreaMenuRect] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    setAreaMenuOpen(false)
    setUserMenuOpen(false)
  }, [path])

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
    setAreaMenuRect({ top: rect.bottom + 6, left: rect.left, width: rect.width })
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
    window.addEventListener('scroll', measureAreaMenu, true)
    return () => {
      window.removeEventListener('resize', measureAreaMenu)
      window.removeEventListener('scroll', measureAreaMenu, true)
    }
  }, [areaMenuOpen, measureAreaMenu])

  const bellLabel = `Notifications, ${taskCount} need${taskCount === 1 ? 's' : ''} your attention`

  return (
    <div data-sidebar-scroll className="flex h-full flex-col justify-between gap-3 overflow-y-auto px-3 pb-3">
      <div className="flex min-h-0 flex-col gap-3">
        <div className={cn('flex shrink-0 items-center justify-between pl-1.5', topInset ? 'h-[50px] pt-2.5' : 'h-10')}>
          <button
            type="button"
            {...tabClickProps({ url: home.href, label: home.label })}
            aria-label="DALI OS home"
            className="font-os-logo text-xl font-semibold text-os-accent focus:outline-none"
          >
            dali.os
          </button>
          <div className="flex items-center gap-0.5">
            <Tooltip content={bellLabel}>
              <button
                type="button"
                onClick={onToggleBell}
                aria-haspopup="dialog"
                aria-expanded={bellOpen}
                aria-label={bellLabel}
                className={cn(ICON_BUTTON, 'h-[30px] w-[30px]')}
              >
                <Bell className="h-[18px] w-[18px]" />
                {taskCount > 0 && (
                  <span className="absolute right-px top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-os-nav bg-[var(--os-danger-ink)] px-[3px] text-[9px] font-extrabold leading-none text-white">
                    {badgeLabel(taskCount)}
                  </span>
                )}
              </button>
            </Tooltip>
            {onHideRail && (
              <Tooltip content="Hide sidebar">
                <button type="button" onClick={onHideRail} aria-label="Hide sidebar" className={cn(ICON_BUTTON, 'h-7 w-7')}>
                  <PanelLeft className="h-[18px] w-[18px]" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search"
          className="flex h-[34px] w-full shrink-0 items-center gap-2 rounded-lg border border-os-container bg-os-card/70 pl-2.5 pr-1.5 text-sm text-os-muted transition-colors hover:text-foreground"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <span>Search</span>
          <kbd className="ml-auto rounded-[5px] bg-os-hover-strong px-1.5 py-0.5 font-sans text-xs font-bold text-os-grey">⌘K</kbd>
        </button>

        <div className="flex shrink-0 gap-1">
          <QuickItem label="Home" icon={Home} active={activeQuick === 'home'} tabProps={tabClickProps({ url: home.href, label: home.label })} />
          <QuickItem
            label="Calendar"
            icon={Calendar}
            active={activeQuick === 'calendar'}
            tabProps={tabClickProps({ url: '/calendar', label: 'Calendar' })}
          />
          {!isAlumni && (
            <QuickItem
              label="Email"
              icon={Mail}
              active={activeQuick === 'email'}
              tooltip={emailUnread > 0 ? `Email · ${emailUnread} unread` : 'Email'}
              dot={emailUnread > 0}
              tabProps={tabClickProps({ url: '/email', label: 'Email' })}
            />
          )}
          {pinned.map((item) => (
            <QuickItem
              key={item.href}
              label={item.label}
              icon={item.icon}
              active={activeQuick === item.href}
              tabProps={tabClickProps({ url: item.href, label: item.label })}
            />
          ))}
        </div>

        {favorites.length > 0 && onFavoritesChange && (
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
          <div className="flex min-h-0 flex-col gap-0.5">
            <div ref={areaMenuRef} className="shrink-0">
              {singleArea ? (
                <p className="flex h-9 items-center gap-2.5 pl-2 text-sm font-semibold text-foreground">
                  <AreaTile areaKey={activeArea.key} size={22} icon={activeArea.icon} />
                  {activeArea.label}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={toggleAreaMenu}
                  aria-haspopup="listbox"
                  aria-expanded={areaMenuOpen}
                  aria-label={`Section: ${activeArea.label}. Switch section`}
                  ref={areaTriggerRef}
                  className="flex h-9 w-full items-center gap-2.5 rounded-lg border border-os-container bg-os-card/70 pl-2 pr-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-os-hover"
                >
                  <AreaTile areaKey={activeArea.key} size={22} icon={activeArea.icon} />
                  <span className="truncate">{activeArea.label}</span>
                  <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-os-muted" aria-hidden />
                </button>
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
                        className={cn(osMenuItemClass, selected && 'font-semibold')}
                      >
                        <AreaTile areaKey={a.key} size={26} icon={a.icon} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{a.label}</span>
                          {a.description && <span className="truncate text-xs font-normal text-os-muted">{a.description}</span>}
                        </span>
                        {selected && <Check className="ml-auto h-3.5 w-3.5 flex-shrink-0 text-os-accent" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {!areaMenuOpen && activeSubtabs.length > 0 && (
              <div className="flex min-h-[5rem] flex-col gap-0.5 overflow-y-auto">
                {activeSubtabs.map((t) => {
                  const active = t.href === activeHref
                  return (
                    <button
                      key={t.href}
                      type="button"
                      {...tabClickProps({ url: t.href, label: t.label })}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        ROW,
                        active ? 'bg-os-hover-strong font-semibold text-foreground' : 'text-foreground hover:bg-os-hover',
                      )}
                    >
                      <t.icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-foreground' : 'text-os-grey')} />
                      <span className="truncate">{t.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center justify-between gap-1">
        <div ref={userMenuRef} className="relative min-w-0">
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
          <button
            type="button"
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex h-8 max-w-full items-center gap-2 rounded-lg pl-1 pr-2 transition-colors hover:bg-os-hover"
          >
            <span className="relative flex shrink-0">
              {photoUrl ? (
                <img src={photoUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-os-accent text-[10px] font-extrabold text-os-bg">
                  {initials}
                </span>
              )}
              {showWhatsNewDot && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-os-accent" aria-hidden />
              )}
            </span>
            <span className="truncate text-sm font-semibold text-foreground">{userName}</span>
            <ChevronDown className="h-2.5 w-2.5 shrink-0 text-os-muted" aria-hidden />
          </button>
        </div>
        <Tooltip content="Help">
          <button
            type="button"
            {...tabClickProps({ url: '/help', label: 'Help' })}
            aria-label="Help"
            className={cn(ICON_BUTTON, 'h-[30px] w-[30px]')}
          >
            <HelpCircle className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
