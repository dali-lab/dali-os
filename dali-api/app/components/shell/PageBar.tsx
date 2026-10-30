import type { ReactNode } from 'react'
import { AppWindow, Link as LinkIcon, Star, type LucideIcon } from 'lucide-react'
import { Menu, Tooltip } from '~/components/ui/floating'
import { AreaTile } from '~/components/shell/AreaTile'
import { OverflowMenu } from '~/components/shell/OverflowMenu'
import { cn } from '~/lib/cn'
import { PageDocButton } from '~/components/page-docs/PageDocButton'
import { PageBarTrail, useDocumentTitle, usePageTrail } from '~/components/Breadcrumbs'
import { TablessHistoryNav } from '~/components/TablessHistoryNav'
import { usePageBarTargetSetters } from '~/components/shell/page-bar-slot'
import { pageBarCrumbs } from '~/components/shell/page-bar-model'
import { useFeatureFlag } from '~/components/FeatureFlags'
import { UNSAFE_DataRouterStateContext, UNSAFE_LocationContext, UNSAFE_RouteContext, useLocation } from 'react-router'
import { useDisplayedTab } from '~/components/shell/displayed-tab'
import { useIsBrowserDesktopCandidate } from '~/lib/desktop-candidate'
import { useOpenCurrentPageInDesktop } from '~/components/shell/useOpenCurrentPageInDesktop'
import { RecordingPill } from '~/components/meeting-recorder/RecordingPill'

export const PAGE_BAR_BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-os-grey transition-colors hover:bg-os-hover hover:text-foreground disabled:opacity-40'

export const COPY_LINK_SHORTCUT = '⌘⇧C'
export const FAVORITE_SHORTCUT = '⌘D'

export type PageStar = {
  favorited: boolean
  inSidebar: boolean
  canToggle: boolean
  toggle: () => Promise<void>
}

export function starLabels(star: Pick<PageStar, 'favorited' | 'inSidebar'>) {
  const action = star.favorited ? 'Remove this page from favorites' : 'Add this page to favorites'
  return { tooltip: star.inSidebar ? 'Already in the sidebar' : action, aria: action }
}

/** Renders its children against the kept tab on screen while the router is still loading that tab's location. */
function DisplayedPage({ children }: { children: ReactNode }) {
  const displayed = useDisplayedTab()
  if (!displayed) return <>{children}</>
  return (
    <UNSAFE_DataRouterStateContext.Provider value={displayed.data}>
      <UNSAFE_LocationContext.Provider value={displayed.location}>
        <UNSAFE_RouteContext.Provider value={displayed.route}>{children}</UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </UNSAFE_DataRouterStateContext.Provider>
  )
}

function usePageBarHeading() {
  const displayed = useDisplayedTab()
  const trail = usePageTrail()
  const documentTitle = useDocumentTitle()
  const { pathname, search } = useLocation()
  const community = useFeatureFlag('community')
  const crumbs = pageBarCrumbs({
    path: pathname + search,
    trail: trail?.crumbs ?? [],
    title: displayed ? displayed.label : documentTitle,
    flags: { community },
  })
  return { trail, crumbs }
}

function PageBarCrumbs() {
  return <PageBarTrail crumbs={usePageBarHeading().crumbs} />
}

function PageBarTrailAction() {
  return <>{usePageBarHeading().trail?.action}</>
}

export function PageBar({
  tabs,
  leading,
  areaKey,
  icon,
  star,
  onCopyLink,
}: {
  tabs: boolean
  leading?: ReactNode
  /** The page's section, shown as its tile beside the breadcrumb. */
  areaKey?: string
  /** Overrides the area's glyph; with no areaKey the tile wears the default tone. */
  icon?: LucideIcon
  star: PageStar
  onCopyLink: () => void
}) {
  const { actionsRef, presenceRef } = usePageBarTargetSetters()
  const labels = starLabels(star)
  const desktopTabs = useFeatureFlag('desktop-tabs')
  const browserDesktop = useIsBrowserDesktopCandidate()
  const showOpenInApp = desktopTabs && browserDesktop
  const openInApp = useOpenCurrentPageInDesktop()

  return (
    <div
      className={cn(
        // Without the tab strip the bar is taller for air at the window edge;
        // content stays centered so the divider gap matches the top gap.
        'flex shrink-0 items-center justify-between gap-3 border-b border-os-container bg-os-bg pl-5 pr-3',
        tabs ? 'h-11' : 'h-[54px]',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {leading}
        {/* Pull the ‹ › group toward the edge so its slack (the icons sit
            inset inside 32px hit areas) doesn't read as extra left padding;
            empty:ml-0 keeps the trail in place when the nav doesn't render. */}
        <div className="-ml-2 hidden empty:ml-0 md:block">
          <TablessHistoryNav tabless tabs={tabs} />
        </div>
        {(areaKey || icon) && <AreaTile areaKey={areaKey ?? 'default'} size={22} icon={icon} />}
        <DisplayedPage>
          <PageBarCrumbs />
        </DisplayedPage>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <RecordingPill />
        <div ref={actionsRef} className="flex items-center gap-1 empty:hidden" />
        <div ref={presenceRef} className="flex items-center empty:hidden" />
        <DisplayedPage>
          <PageBarTrailAction />
        </DisplayedPage>
        <PageDocButton variant="pagebar" />
        <Tooltip content={`${labels.tooltip} · ${FAVORITE_SHORTCUT}`}>
          <button
            type="button"
            disabled={!star.canToggle}
            onClick={() => void star.toggle()}
            aria-label={labels.aria}
            aria-pressed={star.favorited}
            className={cn(PAGE_BAR_BUTTON, star.favorited && 'text-os-accent')}
          >
            <Star className={cn('h-[18px] w-[18px]', star.favorited && 'fill-current')} />
          </button>
        </Tooltip>
        <OverflowMenu
          shellItems={
            <>
              {showOpenInApp && (
                <Menu.Item icon={<AppWindow className="h-3.5 w-3.5" />} onSelect={openInApp}>
                  Open in desktop app
                </Menu.Item>
              )}
              <Menu.Item
                icon={<LinkIcon className="h-3.5 w-3.5" />}
                shortcut={COPY_LINK_SHORTCUT}
                onSelect={onCopyLink}
              >
                Copy link
              </Menu.Item>
            </>
          }
        />
      </div>
    </div>
  )
}
