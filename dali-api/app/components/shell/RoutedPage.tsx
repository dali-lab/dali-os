import { Outlet, useMatches } from 'react-router'
import { cn } from '~/lib/cn'
import { PageDocOutlet } from '~/components/page-docs/PageDocButton'
import { ActivityOverlay } from '~/components/activities/ActivityChrome'
import { paneFlag } from '~/lib/pane-flags'

type Matches = ReturnType<typeof useMatches>

export function paneFlags(matches: Matches) {
  return {
    // A page that declares `fitViewport` fills the shell's main column rather
    // than growing with its content, so a page short enough to fit can centre
    // itself against the window instead of forcing a scrollbar.
    fitViewport: matches.some((m) => paneFlag(m, 'fitViewport')),
    flushPane: matches.some((m) => (m as { handle?: { flushPane?: boolean } }).handle?.flushPane),
    // `bleedPane` pages (the home hero) paint edge to edge with no gutter at all.
    bleedPane: matches.some((m) => paneFlag(m, 'bleedPane')),
  }
}

/**
 * The routed page and its gutters. Reads its route from hooks, not props, so a
 * kept-alive tab (TabKeepAlive) renders with its own route's classes.
 */
export function RoutedPage() {
  const { fitViewport, flushPane, bleedPane } = paneFlags(useMatches())
  return (
    <div
      className={cn(
        'w-full',
        fitViewport && 'flex min-h-0 flex-1 flex-col',
        // The dali.os view gutter: 64px sides, 60px top on a page that starts
        // with its own title. A page's own sub-nav is a segmented pill sized to
        // its content, not a bar bleeding to the window edges, so it wants the
        // same gutter every other page gets. `flushPane` pages (calendar) fill
        // the pane instead — large side/bottom gutters left a floating box and
        // a page scrollbar.
        bleedPane
          ? ''
          : flushPane
            ? 'px-4 pb-3 pt-3 sm:px-5 lg:px-5 lg:pb-3 lg:pt-4'
            : 'px-5 pb-12 pt-6 sm:px-10 lg:px-16 lg:pt-8',
      )}
    >
      <div className={cn(fitViewport && 'flex min-h-0 min-w-0 flex-1 flex-col')}>
        <PageDocOutlet>
          <Outlet />
        </PageDocOutlet>
      </div>
      {/* On-page activity codes for the current route. */}
      <ActivityOverlay />
    </div>
  )
}
