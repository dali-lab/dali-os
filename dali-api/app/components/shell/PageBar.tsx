import type { ReactNode } from 'react'
import { AppWindow, Link as LinkIcon, Star } from 'lucide-react'
import { Menu, Tooltip } from '~/components/ui/floating'
import { OverflowMenu } from '~/components/shell/OverflowMenu'
import { cn } from '~/lib/cn'
import { PageDocButton } from '~/components/page-docs/PageDocButton'
import { PageBarTrail, useDocumentTitle, usePageTrail } from '~/components/Breadcrumbs'
import { TablessHistoryNav } from '~/components/TablessHistoryNav'
import { usePageBarTargetSetters } from '~/components/shell/page-bar-slot'
import { pageBarCrumbs } from '~/components/shell/page-bar-model'
import { useFeatureFlag } from '~/components/FeatureFlags'
import { useLocation } from 'react-router'
import { useIsBrowserDesktopCandidate } from '~/lib/desktop-candidate'
import { useOpenCurrentPageInDesktop } from '~/components/shell/useOpenCurrentPageInDesktop'

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

export function PageBar({
  tabs,
  leading,
  star,
  onCopyLink,
}: {
  tabs: boolean
  leading?: ReactNode
  star: PageStar
  onCopyLink: () => void
}) {
  const trail = usePageTrail()
  const title = useDocumentTitle()
  const { pathname, search } = useLocation()
  const community = useFeatureFlag('community')
  const crumbs = pageBarCrumbs({
    path: pathname + search,
    trail: trail?.crumbs ?? [],
    title,
    flags: { community },
  })
  const { actionsRef, presenceRef } = usePageBarTargetSetters()
  const labels = starLabels(star)
  const desktopTabs = useFeatureFlag('desktop-tabs')
  const browserDesktop = useIsBrowserDesktopCandidate()
  const showOpenInApp = desktopTabs && browserDesktop
  const openInApp = useOpenCurrentPageInDesktop()

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-3 bg-os-bg pl-5 pr-3',
        tabs ? 'h-11' : 'h-[54px] pt-2.5',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="hidden md:block">
          <TablessHistoryNav tabless tabs={tabs} />
        </div>
        <PageBarTrail crumbs={crumbs} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <div ref={actionsRef} className="flex items-center gap-1 empty:hidden" />
        <div ref={presenceRef} className="flex items-center empty:hidden" />
        {trail?.action}
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
