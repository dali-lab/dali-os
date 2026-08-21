import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from 'react'

/* A dropdown that opens in the flow of the scrolling sidebar (in-flow so the
   rail can't clip it — see the shells' area switchers). Left to itself a long
   list grows the rail past the viewport, so the whole nav scrolls and the
   trigger can be pushed out of sight. The overflow the panel causes is exactly
   the height it has to give back: measure it once open and cap the panel there,
   so the list scrolls inside its own box and the nav stays put.

   Needs a `data-sidebar-scroll` ancestor — the element whose height the panel
   has to fit inside. */

// Below this a capped panel stops being a list. If the rail is already
// overflowing without the panel there's no height to win back, so take the
// floor and let the nav scroll as it did before.
const MIN_HEIGHT = 160

export function SidebarMenuPanel({ children, ...rest }: ComponentPropsWithoutRef<'div'>) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Before paint: the panel is only ever mounted by a click, so it never runs
  // on the server, and measuring after paint would show a frame of the rail
  // scrolled.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const scroller = panel?.closest<HTMLElement>('[data-sidebar-scroll]')
    if (!panel || !scroller) return

    const fit = () => {
      // Measure from the panel's natural height, so it re-grows when the rail
      // gets taller rather than staying at the smallest cap it ever needed.
      panel.style.maxHeight = ''
      const overflow = scroller.scrollHeight - scroller.clientHeight
      if (overflow <= 0) return
      panel.style.maxHeight = `${Math.max(MIN_HEIGHT, panel.offsetHeight - overflow)}px`
    }

    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <div ref={panelRef} {...rest}>
      {children}
    </div>
  )
}
