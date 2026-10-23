import type { ReactNode } from 'react'
import { Link as LinkIcon, Star } from 'lucide-react'
import { Tooltip } from '~/components/ui/floating'
import { cn } from '~/lib/cn'
import { PageDocButton } from '~/components/page-docs/PageDocButton'
import { PageBarTrail, useDocumentTitle, usePageTrail } from '~/components/Breadcrumbs'
import { TablessHistoryNav } from '~/components/TablessHistoryNav'
import { usePageBarTargetSetters } from '~/components/shell/page-bar-slot'

export const PAGE_BAR_BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-os-grey transition-colors hover:bg-os-hover hover:text-foreground disabled:opacity-40'

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
  const { actionsRef, presenceRef } = usePageBarTargetSetters()
  const labels = starLabels(star)

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 bg-os-bg pl-5 pr-3">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="hidden md:block">
          <TablessHistoryNav tabless tabs={tabs} />
        </div>
        <PageBarTrail trail={trail} title={title} />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <div ref={actionsRef} className="flex items-center gap-1 empty:hidden" />
        <div ref={presenceRef} className="flex items-center empty:hidden" />
        {trail?.action}
        <PageDocButton variant="pagebar" />
        <Tooltip content="Copy link to this page">
          <button type="button" onClick={onCopyLink} aria-label="Copy link to this page" className={PAGE_BAR_BUTTON}>
            <LinkIcon className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
        <Tooltip content={labels.tooltip}>
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
      </div>
    </div>
  )
}
