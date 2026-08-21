import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useNavigate, useRevalidator } from 'react-router'
import type { TabWorkspaceHandle, OpenTabRequest } from '~/components/TabWorkspace'
import { TASKS_CHANGED_EVENT } from '~/components/NotificationBell'
import { FAVORITES_CHANGED_EVENT } from '~/components/favorites-live'

/**
 * The navigation behaviour every app shell shares: how a sidebar row opens a
 * surface (workspace tab vs. top-window navigation), the ⌘K palette, and the
 * postMessage bridge that embedded workspace iframes talk to the shell over.
 *
 * Lives outside the shells because it is the contract with TabWorkspace, not a
 * matter of how a shell looks — a fix here (a new message type, a modifier-key
 * rule) has to land in every shell at once or the shells diverge in behaviour
 * while looking merely different.
 *
 * @param tabless true when the routed page renders directly in the main column
 *   rather than inside the tabbed workspace; there is no workspace to open
 *   tabs in, so everything navigates the top window instead.
 */
export function useShellNav(tabless: boolean) {
  const navigate = useNavigate()
  const { revalidate } = useRevalidator()
  const workspaceRef = useRef<TabWorkspaceHandle | null>(null)

  // Held in refs so the message listener (mounted once) always calls the
  // latest values without needing to re-subscribe.
  const revalidateRef = useRef(revalidate)
  revalidateRef.current = revalidate
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const tablessRef = useRef(tabless)
  tablessRef.current = tabless

  const [paletteOpen, setPaletteOpen] = useState(false)
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), [])

  // ⌘/Ctrl+K opens the command palette. In tab mode TabWorkspace owns the
  // listener (its handler is attached to the shell window AND every iframe's
  // document, so it fires wherever focus is) and calls togglePalette via
  // onOpenPalette. In tabless mode there's no TabWorkspace, so listen here.
  // Gating on `tabless` avoids both handlers firing for one keypress.
  useEffect(() => {
    if (!tabless) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        togglePalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabless, togglePalette])

  const openInWorkspace = useCallback(
    (req: OpenTabRequest) => {
      if (tabless) {
        navigate(req.url)
        return
      }
      workspaceRef.current?.openTab(req)
    },
    [tabless, navigate],
  )

  // Open a palette result. Mirrors sidebar navigation: tabless → navigate the
  // top window (⌘Enter → real browser tab); tab mode → a kept workspace tab
  // (⌘Enter → split-pane). The user picked this explicitly, so no ephemeral tab.
  const openFromPalette = useCallback(
    (url: string, label: string, toSide: boolean) => {
      if (tabless) {
        if (toSide) window.open(url, '_blank', 'noopener')
        else navigate(url)
        return
      }
      if (toSide) workspaceRef.current?.openTabToSide({ url, label })
      else workspaceRef.current?.openTab({ url, label })
    },
    [tabless, navigate],
  )

  // Props bundle for any sidebar button that opens a surface. In tab mode it
  // opens a workspace tab; in tabless mode it navigates the top window like a
  // normal site. Both preserve the browser-style modifier shortcuts:
  //   - Cmd/Ctrl + click  → tab mode: open to the side (split-pane);
  //                         tabless: open a real browser tab
  //   - middle-click       → tab mode: open in background;
  //                         tabless: open a real browser tab
  // `auxClick` fires for middle/right-click; we filter to button 1 (middle)
  // and preventDefault so the browser doesn't autoscroll.
  const tabClickProps = useCallback(
    (req: OpenTabRequest) => {
      if (tabless) {
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
      }
      return {
        onClick: (e: React.MouseEvent) => {
          if (e.metaKey || e.ctrlKey) {
            workspaceRef.current?.openTabToSide(req)
            return
          }
          // Single-click from the sidebar opens a preview (ephemeral) tab: it reuses
          // the pane's preview slot instead of stacking, so skimming sections never
          // piles up tabs. Promoted to a kept tab on double-click / navigating in it.
          workspaceRef.current?.openTab(req, { ephemeral: true })
        },
        onAuxClick: (e: React.MouseEvent) => {
          if (e.button !== 1) return
          e.preventDefault()
          workspaceRef.current?.openTabInBackground(req)
        },
      }
    },
    [tabless, navigate],
  )

  // Listen for "open in new tab" requests from embedded iframes (e.g. a
  // notification card in the Home tab whose link would otherwise navigate
  // the iframe itself, trapping the user in chrome-less embed mode).
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data
      if (!data) return
      if (data.type === 'dali:openTab' && typeof data.url === 'string') {
        // Tabless has no workspace; navigate the top window instead. (Reaches
        // here e.g. from the launch tour's "finish" posting to this window.)
        if (tablessRef.current) navigateRef.current(data.url)
        else workspaceRef.current?.openTab({ url: data.url, label: data.label || data.url })
      } else if (data.type === 'dali:openTabToSide' && typeof data.url === 'string') {
        // Open in a second pane to the side (splitting if needed) — used by an
        // embedded page that wants its target as a split-screen tab, e.g. a
        // project document opening beside the project page. No side pane in
        // tabless mode, so fall back to a plain navigation.
        if (tablessRef.current) navigateRef.current(data.url)
        else workspaceRef.current?.openTabToSide({ url: data.url, label: data.label || data.url })
      } else if (
        data.type === 'dali:setTabLabel' &&
        typeof data.url === 'string' &&
        typeof data.label === 'string'
      ) {
        workspaceRef.current?.setTabLabel(data.url, data.label)
      } else if (data.type === 'dali:closeTab' && typeof data.url === 'string') {
        // An embedded page retracting a split-screen tab it opened earlier —
        // e.g. the project hub closing a document pane when the user leaves the
        // subtab that spawned it. Tabless mode never opened one, so ignore it
        // there rather than navigating the top window somewhere unasked.
        if (!tablessRef.current) workspaceRef.current?.closeTabByUrl(data.url)
      } else if (data.type === 'dali:profileUpdated') {
        // A profile edit inside a workspace iframe doesn't re-run the shell
        // loader, so re-fetch it to refresh the footer avatar.
        revalidateRef.current()
      } else if (data.type === 'dali:documentTitleChanged') {
        // A doc title edit in one tab (e.g. a split-screen document) doesn't
        // touch a sibling tab's own loader (e.g. the project hub's Documents
        // list). Relay to every open iframe; each one ignores it unless its
        // own listener cares about this pageId.
        workspaceRef.current?.broadcast(data)
      } else if (data.type === TASKS_CHANGED_EVENT) {
        // Confirming/acting on a task inside an iframe (e.g. Home) doesn't
        // touch the shell's task poller. Relay it to a same-window event so
        // the sidebar Tasks count + list refresh immediately.
        window.dispatchEvent(new Event(TASKS_CHANGED_EVENT))
      } else if (data.type === FAVORITES_CHANGED_EVENT) {
        // A star clicked inside an iframe: the header's starred list belongs to
        // this document, so relay it for useLiveFavorites to re-read.
        window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT))
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  return {
    workspaceRef,
    paletteOpen,
    setPaletteOpen,
    togglePalette,
    openInWorkspace,
    openFromPalette,
    tabClickProps,
  }
}
