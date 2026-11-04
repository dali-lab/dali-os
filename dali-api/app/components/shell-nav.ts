import { useCallback, useEffect, useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router'
import { COPY_PAGE_LINK_EVENT } from '~/lib/page-link'
import { isCommandKShortcut, isCopyPageLinkShortcut, isFavoriteShortcut } from '~/lib/shortcuts'
import { tabActions } from '~/lib/desktop-tabs-store'
import type { OpenTabRequest } from '~/lib/desktop-tabs'
import { TOGGLE_FAVORITE_EVENT } from '~/components/favorites-live'
import { panelCoversPage } from '~/components/side-panel/use-side-panel'
import { SIDE_PARAM, formatSidePanel, sidePanelForUrl } from '~/lib/side-panel'

/**
 * The navigation behaviour every app shell shares: how a sidebar row opens a
 * surface (desktop tab vs. top-window navigation) and the ⌘K palette.
 *
 * Lives outside the shells because a fix here (a modifier-key rule) has to land
 * in every shell at once or the shells diverge in behaviour while looking
 * merely different.
 *
 * @param opts.tabs desktop tabs are showing: surfaces open as tabs. opts.sidePanel:
 *   ⌘Enter on a document opens it beside the page.
 */
export function useShellNav(opts: { tabs?: boolean; sidePanel?: boolean } = {}) {
  const tabs = opts.tabs === true
  const sidePanel = opts.sidePanel === true
  const navigate = useNavigate()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCommandKShortcut(e)) {
        e.preventDefault()
        togglePalette()
      } else if (isCopyPageLinkShortcut(e)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent(COPY_PAGE_LINK_EVENT))
      } else if (isFavoriteShortcut(e)) {
        const handled = !window.dispatchEvent(new CustomEvent(TOGGLE_FAVORITE_EVENT, { cancelable: true }))
        if (handled) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePalette])

  const openInWorkspace = useCallback(
    (req: OpenTabRequest) => {
      if (tabs) {
        tabActions.open(req)
        return
      }
      navigate(req.url)
    },
    [tabs, navigate],
  )

  // Open a palette result. Mirrors sidebar navigation: navigate the top window
  // (⌘Enter → real browser tab, or a background desktop tab). The user picked
  // this explicitly, so no ephemeral tab.
  const openFromPalette = useCallback(
    (url: string, label: string, toSide: boolean) => {
      const panel = toSide && sidePanel ? sidePanelForUrl(url) : null
      if (panel) {
        const params = new URLSearchParams(window.location.search)
        params.set(SIDE_PARAM, formatSidePanel(panel))
        navigate(`${window.location.pathname}?${params}`, { replace: !panelCoversPage(), preventScrollReset: true })
        return
      }
      if (tabs) {
        tabActions.open({ url, label }, { background: toSide })
        return
      }
      if (toSide) window.open(url, '_blank', 'noopener')
      else navigate(url)
    },
    [sidePanel, tabs, navigate],
  )

  // Props bundle for any sidebar button that opens a surface: a desktop tab, or
  // a top-window navigation like a normal site. Both preserve the browser-style
  // modifier shortcuts: Cmd/Ctrl + click and middle-click open in the background
  // (a desktop tab) or a real browser tab. `auxClick` fires for middle/right-click;
  // we filter to button 1 (middle) and preventDefault so the browser doesn't
  // autoscroll.
  const tabClickProps = useCallback(
    (req: OpenTabRequest) => {
      if (tabs) {
        // Desktop tabs follow browser tabs: ⌘-click and middle-click open in
        // the background; a plain click previews in the reusable preview tab.
        return {
          onClick: (e: React.MouseEvent) => {
            tabActions.open(req, e.metaKey || e.ctrlKey ? { background: true } : { ephemeral: true })
          },
          onAuxClick: (e: React.MouseEvent) => {
            if (e.button !== 1) return
            e.preventDefault()
            tabActions.open(req, { background: true })
          },
        }
      }
      return {
        onClick: (e: React.MouseEvent) => {
          // These are <button>s (no href), so a new browser tab needs an
          // explicit window.open — the browser won't synthesize one.
          if (e.metaKey || e.ctrlKey) {
            window.open(req.url, '_blank', 'noopener')
            return
          }
          navigate(req.url)
        },
        onAuxClick: (e: React.MouseEvent) => {
          if (e.button !== 1) return
          e.preventDefault()
          window.open(req.url, '_blank', 'noopener')
        },
      }
    },
    [tabs, navigate],
  )

  return {
    paletteOpen,
    setPaletteOpen,
    togglePalette,
    openInWorkspace,
    openFromPalette,
    tabClickProps,
  }
}
