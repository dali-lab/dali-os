import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, Pin, PinOff, Plus, X, XSquare } from 'lucide-react'
import { ContextMenu, Menu, Tooltip } from '~/components/ui/floating'
import { desktopVersion } from '~/lib/desktop'
import { readTabStripCookie, tabsPreferred, writeTabStripCookie } from '~/lib/desktop-tabs-pref'
import {
  getTabsSnapshot,
  startTabs,
  tabsActive,
  subscribeTabs,
  tabActions,
} from '~/lib/desktop-tabs-store'
import type { DesktopTab, DesktopTabsState } from '~/lib/desktop-tabs'
import { buildPageLink, writePageLink } from '~/lib/page-link'
import { cn } from '~/lib/cn'
import { stripAppTitle } from '~/lib/page-title'
import { fallbackPageLabel } from '~/components/shell/page-bar-model'
import { usePageTrail } from '~/components/Breadcrumbs'
import { tabIcon } from '~/lib/tab-icon'

/** Fired by the desktop app's File menu (desktop/src-tauri/src/menu.rs), which
 *  owns ⌘T / ⌘W / ⌘⇧T so the native Close Window shortcut can't win. */
export const TAB_COMMAND_EVENT = 'dali:tab-command'
type TabCommand = 'new' | 'close' | 'reopen'

export function useDesktopTabsState(): DesktopTabsState {
  return useSyncExternalStore(subscribeTabs, getTabsSnapshot, getTabsSnapshot)
}

function pageTitle(): string {
  if (typeof document === 'undefined') return ''
  return stripAppTitle(document.title)
}

/**
 * Whether this window shows desktop tabs, and while it does, keep the tab store
 * in step with the router. `hint` is the server's guess (the strip cookie) so
 * the first paint already has the strip's space; the client corrects it once
 * it knows whether it is inside the desktop app.
 */
export function useDesktopTabs(enabled: boolean, hint: boolean): boolean {
  const [show, setShow] = useState(enabled && hint)
  useEffect(() => {
    if (!enabled || desktopVersion() === null) {
      setShow(false)
      return
    }
    const cookie = readTabStripCookie()
    if (cookie === null) writeTabStripCookie('1')
    setShow(tabsPreferred(cookie))
  }, [enabled])

  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const url = location.pathname + location.search
  const arrivalRef = useRef(url)
  arrivalRef.current = url

  useEffect(() => {
    if (!show) return
    return startTabs({ url: arrivalRef.current, label: pageTitle() || fallbackPageLabel(arrivalRef.current) || 'Home' }, (to, opts) =>
      navigateRef.current(to, { replace: true, state: opts?.tabSwitch ? { tabSwitch: true } : undefined }),
    )
  }, [show])

  useEffect(() => {
    if (!show) return
    const restoreY = tabActions.record(url, navigationType)
    let raf = 0
    if (restoreY !== null) raf = window.requestAnimationFrame(() => window.scrollTo(0, restoreY))
    const labelTimer = window.setTimeout(() => tabActions.label(url, pageTitle() || fallbackPageLabel(url)), 50)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(labelTimer)
    }
  }, [show, url, navigationType])

  const emoji = usePageTrail()?.crumbs.at(-1)?.emoji ?? null
  useEffect(() => {
    if (show) tabActions.emoji(url, emoji)
  }, [show, url, emoji])

  useEffect(() => {
    if (!show) return
    // Cancelling tells the shell the page handled it (window::tab_command).
    const onCommand = (e: Event) => {
      const command = (e as CustomEvent<{ command?: TabCommand }>).detail?.command
      if (command === 'new') tabActions.newTab()
      else if (command === 'close') tabActions.closeActive()
      else if (command === 'reopen') tabActions.reopenClosed()
      else return
      e.preventDefault()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        tabActions.closeActive()
        return
      }
      if (e.altKey && !e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        tabActions.cycle(e.key === 'ArrowRight' ? 1 : -1)
        return
      }
      if (!e.altKey && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        tabActions.activateIndex(e.key === '9' ? -1 : Number(e.key) - 1)
      }
    }
    window.addEventListener(TAB_COMMAND_EVENT, onCommand)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(TAB_COMMAND_EVENT, onCommand)
      window.removeEventListener('keydown', onKey)
    }
  }, [show])

  return show
}

const TAB_W = 168

function SortableTab({
  tab,
  active,
  onContextMenu,
}: {
  tab: DesktopTab
  active: boolean
  onContextMenu?: MouseEventHandler<HTMLButtonElement>
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  })
  const Icon = tabIcon(tab.url)
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    flexBasis: tab.pinned ? undefined : TAB_W,
    opacity: isDragging ? 0.4 : undefined,
  }
  const button = (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      type="button"
      onClick={() => tabActions.activate(tab.id)}
      onDoubleClick={() => tabActions.promote(tab.id)}
      onContextMenu={onContextMenu}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        tabActions.close(tab.id)
      }}
      aria-current={active ? 'page' : undefined}
      aria-label={tab.pinned ? tab.label : undefined}
      className={cn(
        'group flex h-7 items-center rounded-md border text-[13px] font-medium whitespace-nowrap transition-colors',
        tab.pinned ? 'w-[34px] shrink-0 justify-center' : 'min-w-[72px] shrink grow-0 gap-2 pl-3',
        !tab.pinned && (active ? 'pr-2' : 'pr-3'),
        active
          ? 'border-os-container bg-os-card text-foreground shadow-[0_1px_1px_var(--color-os-hover)]'
          : 'border-transparent text-os-grey hover:bg-os-hover',
      )}
    >
      {tab.emoji ? (
        <span aria-hidden className="pointer-events-none w-4 shrink-0 text-center text-[14px] leading-none">
          {tab.emoji}
        </span>
      ) : (
        <Icon className={cn('pointer-events-none h-4 w-4 shrink-0', active ? 'text-foreground' : 'text-os-grey')} />
      )}
      {!tab.pinned && (
        <>
          <span
            className={cn(
              'pointer-events-none flex-1 truncate text-left',
              active ? 'font-semibold text-foreground' : 'text-os-grey',
              tab.ephemeral && 'italic',
            )}
          >
            {tab.label}
          </span>
          <span
            role="button"
            aria-label={`Close ${tab.label}`}
            // Keep a press on × from starting a tab drag.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              tabActions.close(tab.id)
            }}
            className={cn(
              'rounded p-0.5 text-os-grey hover:bg-os-hover-strong hover:text-foreground',
              active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <X className="h-3 w-3" />
          </span>
        </>
      )}
    </button>
  )
  return tab.pinned ? <Tooltip content={tab.label}>{button}</Tooltip> : button
}

export function DesktopTabStrip({
  leading,
  initial = null,
}: {
  leading?: ReactNode
  initial?: DesktopTabsState | null
}) {
  const live = useDesktopTabsState()
  const { tabs, activeId } = tabsActive() || !initial ? live : initial
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const lastPinned = tabs.reduce((last, t, i) => (t.pinned ? i : last), -1)
  const activeIndex = tabs.findIndex((t) => t.id === activeId)

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const to = tabs.findIndex((t) => t.id === e.over!.id)
    if (to >= 0) tabActions.move(String(e.active.id), to)
  }

  return (
    <nav
      aria-label="Open tabs"
      className="flex h-10 shrink-0 items-center gap-1 border-b border-os-container bg-os-nav pl-2 pr-3"
    >
      {leading}
      <DndContext id="desktop-tabs" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            {tabs.map((tab, index) => (
              <Fragment key={tab.id}>
              {/* Tabs sit flush as one connected strip; a hairline separates
                  neighbours except beside the active tab, which reads as its
                  own raised card. */}
              {index > 0 && index - 1 !== lastPinned && (
                <span
                  aria-hidden
                  className={cn(
                    'h-4 w-px shrink-0 bg-os-container transition-opacity',
                    (index === activeIndex || index - 1 === activeIndex) && 'opacity-0',
                  )}
                />
              )}
              <ContextMenu
                ariaLabel="Tab actions"
                items={
                  <>
                    <Menu.Item
                      icon={tab.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      onSelect={() => tabActions.togglePin(tab.id)}
                    >
                      {tab.pinned ? 'Unpin tab' : 'Pin tab'}
                    </Menu.Item>
                    <Menu.Item
                      icon={<Copy className="h-3.5 w-3.5" />}
                      onSelect={() => void writePageLink(buildPageLink(tab.url, window.location.origin))}
                    >
                      Copy link
                    </Menu.Item>
                    <Menu.Separator />
                    <Menu.Item icon={<X className="h-3.5 w-3.5" />} onSelect={() => tabActions.close(tab.id)}>
                      Close tab
                    </Menu.Item>
                    <Menu.Item
                      icon={<XSquare className="h-3.5 w-3.5" />}
                      disabled={tabs.length < 2}
                      onSelect={() => tabActions.closeOthers(tab.id)}
                    >
                      Close other tabs
                    </Menu.Item>
                  </>
                }
              >
                <SortableTab tab={tab} active={tab.id === activeId} />
              </ContextMenu>
              {index === lastPinned && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-os-container-hi" />}
              </Fragment>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Tooltip content="New tab">
        <button
          type="button"
          onClick={() => tabActions.newTab()}
          aria-label="New tab"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-os-grey transition-colors hover:bg-os-hover hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </Tooltip>
    </nav>
  )
}
