import { Fragment, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Menu, Tooltip } from '~/components/ui/floating'
import { usePageBarMenuItems } from '~/components/shell/page-bar-slot'

export const OVERFLOW_BUTTON =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-os-grey transition-colors hover:bg-os-hover hover:text-foreground'

/**
 * The one "more actions" menu of a header: the page's registered entries, then
 * a separator, then the shell's own.
 */
export function OverflowMenu({ shellItems }: { shellItems?: ReactNode }) {
  const pageItems = usePageBarMenuItems()
  const hasPageItems = pageItems.length > 0
  return (
    <Menu
      align="right"
      ariaLabel="More actions"
      trigger={
        <Tooltip content="More">
          <button type="button" aria-label="More actions" className={OVERFLOW_BUTTON}>
            <MoreHorizontal className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
      }
    >
      {pageItems.map((items, i) => (
        <Fragment key={i}>{items}</Fragment>
      ))}
      {hasPageItems && shellItems && <Menu.Separator />}
      {shellItems}
    </Menu>
  )
}
