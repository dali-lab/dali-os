import { useEffect, useState } from 'react'
import { Outlet, redirect, useLoaderData, useLocation, useMatches, useNavigate, useNavigationType, useSearchParams, type ShouldRevalidateFunctionArgs } from 'react-router'
import { cn } from '~/lib/cn'
import { Layout } from '~/components/Layout'
import { Breadcrumbs } from '~/components/Breadcrumbs'
import { PageDocProvider, PageDocButton, PageDocOutlet } from '~/components/page-docs/PageDocButton'
import { LaunchWelcome } from '~/components/LaunchWelcome'
import { TimeZonePrompt } from '~/components/TimeZonePrompt'
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { getUserRoles, isLabMentor } from '~/lib/roles'
import { getAppGateOutstanding } from '~/signing/lib/state.server'
import { getActiveCycle } from '~/hiring/lib/cycles'
import { prisma } from '~/lib/db'
import { resolvePhotoUrl } from '~/lib/photo'
import { recordPageView } from '~/lib/analytics'
import { isTablessRequest } from '~/lib/tabless'
import { isFocusRequest } from '~/lib/focus-mode'
import { isValidTimezone, resolveUserTimeZone } from '~/lib/timezone'
import { readDismissedTimeZone } from '~/lib/tz-prompt'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (auth.user.type === 'applicant') return redirect('/portal')

  // Onboarding is NOT a hard gate: a new member can use the whole app freely.
  // Their onboarding lives as a persistent task (the welcome notification) that
  // links to /onboarding and only clears once they finish. See welcome.server.

  // Drives the sidebar footer avatar. The loader runs on every shell
  // load/revalidation, so this stays in sync after a profile edit. Also tells
  // the launch tour whether to offer the "connect your calendar" step.
  const [partnerRedirect, roles, activeCycle, me] = await Promise.all([
    redirectPartnerToPortal(auth),
    getUserRoles(auth.user.sub),
    getActiveCycle(),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: {
        photoUrl: true,
        timeZone: true,
        calendarLinks: {
          where: { provider: "Google", enabled: true },
          select: { id: true },
          take: 1,
        },
        daliMember: { select: { onboardedAt: true, tourCompletedAt: true } },
      },
    }),
  ])
  if (partnerRedirect) return partnerRedirect

  const {
    isLabMember,
    isCore: core,
    isAdmin: admin,
    isDomainLead: domainLead,
    isInstructor,
    isInterviewer: isInterviewerAnyCycle,
    canViewForms,
    canViewStaffing,
  } = roles

  // Hard gate: a lab member who owes a signature on an app-enforced agreement
  // (membership, mentorship) can only reach the signing surface until they
  // sign. /sign* and /logout are exempt to avoid a redirect loop. Confidentiality
  // is HiringCycle-scoped and gated inside hiring, so it never triggers here.
  {
    const url = new URL(request.url)
    const path = url.pathname
    const gateExempt =
      path === '/sign' || path.startsWith('/sign/') || path.startsWith('/logout')
    if (isLabMember && !gateExempt) {
      const outstanding = await getAppGateOutstanding(auth.user.sub)
      if (outstanding) {
        return redirect(
          `/sign/${outstanding.bindingId}?next=${encodeURIComponent(path + url.search)}`,
        )
      }
    }
  }

  // Whether to show the Hiring tab at all. Core/Admin/DomainLead always; other
  // lab members only if they're a reviewer or interviewer on ANY cycle (not
  // just the active one — a reviewer on a past/future cycle still needs in).
  // getUserRoles already ran the any-cycle interviewer lookup, so only the
  // reviewer half needs its own query here.
  let hasHiringAccess =
    core || admin || domainLead || (isLabMember && isInterviewerAnyCycle)

  const [activeInterviewer, anyCycleReviewer, labMentor, photoUrl] = await Promise.all([
    isLabMember && activeCycle
      ? prisma.cycleInterviewer.findFirst({
          where: { userId: auth.user.sub, applicationCycleId: activeCycle.id },
        })
      : null,
    !hasHiringAccess && isLabMember
      ? prisma.cycleReviewer.findFirst({ where: { userId: auth.user.sub }, select: { id: true } })
      : null,
    // Mentorship area gate: Core (with admin) + any active lab mentor. Hidden
    // from mentees and non-mentor members entirely.
    isLabMember && !core ? isLabMentor(auth.user.sub) : false,
    resolvePhotoUrl(me?.photoUrl),
  ])

  const isInterviewer = !!activeInterviewer
  if (!hasHiringAccess && isLabMember) hasHiringAccess = anyCycleReviewer !== null
  const isLabMentorFlag = isLabMember ? core || labMentor : false
  const hasCalendarLink = (me?.calendarLinks.length ?? 0) > 0

  // Auto-show the launch tour once per USER (server-driven, not browser
  // localStorage): a member who has finished onboarding but not yet completed
  // the tour. Established members were backfilled (tourCompletedAt set), so only
  // the just-onboarded get it. A manual "start tour" button can re-run it later
  // regardless of this flag.
  const shouldShowTour =
    !!me?.daliMember?.onboardedAt && me.daliMember.tourCompletedAt === null

  // Detect iframe context from Sec-Fetch-Dest. Modern browsers (Chrome, Firefox,
  // Safari 16+) set this automatically and it survives server-side redirects,
  // so it works even when ?embed=1 gets stripped from a redirect Location.
  const fetchDest = request.headers.get('sec-fetch-dest')
  const isEmbedded = fetchDest === 'iframe' || fetchDest === 'frame'

  // Tabless mode: render pages directly in the shell instead of the tabbed
  // workspace. Cookie-backed so this SSR branch is decided per-request.
  const tabless = isTablessRequest(request)

  // Focus mode: hide the sidebar (navigate via ⌘K + breadcrumbs). Independent
  // of tabless; also cookie-backed so there's no flash of the sidebar.
  const focus = isFocusRequest(request)

  // Per-user display timezone, threaded to every descendant via
  // useUserTimeZone() so client formatting matches the server (hydration-safe).
  // `explicit` distinguishes "never set" (→ silent auto-detect) from "set to
  // ET"; `dismissedZone` suppresses the change-prompt for a zone the user kept.
  const userTimeZone = resolveUserTimeZone(me)
  const userTimeZoneIsExplicit = isValidTimezone(me?.timeZone)
  const tzDismissedZone = readDismissedTimeZone(request)

  // Pageview is fire-and-forget — never blocks the response.
  recordPageView({
    request,
    userId: auth.user.sub,
    sessionId: auth.sessionId,
  })

  return { user: auth.user, photoUrl, hasCalendarLink, shouldShowTour, isCore: core, isAdmin: admin, isDomainLead: domainLead, canViewForms, canViewStaffing, isInterviewer, hasHiringAccess, isInstructor, isLabMentor: isLabMentorFlag, isEmbedded, tabless, focus, userTimeZone, userTimeZoneIsExplicit, tzDismissedZone }
}

// Layout data (roles, avatar, hiring access) changes rarely, but default
// revalidation re-ran this loader's ~15 queries after every fetcher action and
// search-param change. Only actions that can alter what it returns count.
const LAYOUT_MUTATING_ACTION_PREFIXES = [
  '/settings',
  '/api/tour',
  '/api/timezone',
  '/onboarding',
  '/api/hiring/cycles',
  '/logout',
  '/members',
  // Signing clears the hard gate — revalidate the shell so the gate re-checks.
  '/sign',
]

export function shouldRevalidate({ formAction, currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction) {
    return LAYOUT_MUTATING_ACTION_PREFIXES.some((p) => formAction.startsWith(p))
      ? defaultShouldRevalidate
      : false
  }
  if (currentUrl.pathname === nextUrl.pathname) return false
  return defaultShouldRevalidate
}

export default function AppLayoutRoute() {
  const { user, photoUrl, hasCalendarLink, shouldShowTour, isCore, isAdmin, isDomainLead, canViewForms, canViewStaffing, isInterviewer, hasHiringAccess, isLabMentor: isLabMentorFlag, isEmbedded, tabless, focus, userTimeZone, userTimeZoneIsExplicit, tzDismissedZone } = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigationType = useNavigationType()
  const matches = useMatches()
  const navigate = useNavigate()
  const hasAreaSubnav = matches.some(
    (m) => (m as { handle?: { areaPills?: boolean } }).handle?.areaPills,
  )
  // Pages that land directly on their own title, with no subnav in between,
  // ask for a wider gap under the trail (see adminHandle).
  const roomyBreadcrumb = matches.some(
    (m) => (m as { handle?: { roomyBreadcrumb?: boolean } }).handle?.roomyBreadcrumb,
  )

  // After a client-side navigation inside the workspace iframe, the loader
  // re-runs via fetch — which carries `Sec-Fetch-Dest: empty`, not `iframe` —
  // and `?embed=1` is stripped from the URL by the navigation. Both server
  // signals go stale, so we also check on the client: if our window isn't the
  // top window, we're embedded. Initialized post-mount to avoid a hydration
  // mismatch (the initial document load is correctly resolved by the loader).
  const [isClientEmbedded, setIsClientEmbedded] = useState(false)
  useEffect(() => {
    try {
      setIsClientEmbedded(window.self !== window.top)
    } catch {
      // Cross-origin access throws → we're embedded somewhere we can't see.
      setIsClientEmbedded(true)
    }
  }, [])

  const embedded = isEmbedded || isClientEmbedded || searchParams.get('embed') === '1'

  // When embedded, keep the parent workspace in sync with this iframe on every
  // in-iframe navigation:
  //  - `dali:tabNavigated` updates the tab's stored URL (with `embed=1`
  //    stripped, matching how tabs are stored) so the sidebar highlight tracks
  //    the current page and a reload restores it. The iframe src is pinned to
  //    its mount seed, so this never reloads the frame.
  //  - `dali:setTabLabel` refreshes the tab label from document.title, keyed by
  //    the iframe's RAW location (still carrying `embed=1` on first load). A
  //    sidebar-opened section root is stored without `embed`, so its raw URL
  //    won't match and its friendly sidebar label ("Cycles", "Domain", …) is
  //    preserved; only a deeper client-side navigation (where `embed` has been
  //    dropped from the URL) matches and refines the label.
  // setTimeout gives React Router a tick to write the title from meta.
  useEffect(() => {
    if (!embedded) return
    if (typeof window === 'undefined') return

    const params = new URLSearchParams(location.search)
    params.delete('embed')
    const query = params.toString()
    const cleanUrl = location.pathname + (query ? `?${query}` : '')

    window.parent.postMessage(
      { type: 'dali:tabNavigated', url: cleanUrl },
      window.location.origin,
    )

    const id = window.setTimeout(() => {
      const raw = document.title
      const label = raw.replace(/\s*·\s*DALI OS\s*$/, '').trim() || raw
      if (!label) return
      window.parent.postMessage(
        {
          type: 'dali:setTabLabel',
          url: window.location.pathname + window.location.search,
          label,
        },
        window.location.origin,
      )
    }, 50)
    return () => window.clearTimeout(id)
  }, [embedded, location.pathname, location.search])

  // When embedded, accept `dali:navigate` from the parent TabWorkspace —
  // that's how the per-tab back/forward arrows drive in-iframe navigation.
  // Going through react-router's navigate() keeps the embedded layout's
  // navigation flow consistent (loaders re-run, etc.) and our own
  // `dali:tabNavigated` post just above is what tells the parent the move
  // landed (parent recognises it as a back/forward via a pending-op ref).
  useEffect(() => {
    if (!embedded) return
    if (typeof window === 'undefined') return
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const d = e.data
      if (!d || d.type !== 'dali:navigate' || typeof d.url !== 'string') return
      navigate(d.url)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [embedded, navigate])

  // Scroll restoration WITHIN an embedded tab. React Router's <ScrollRestoration>
  // doesn't reliably restore the iframe window's scroll on in-tab back/forward
  // (the iframe is its own document and RR's key tracking gets lost across the
  // shell↔iframe boundary), so we persist scrollY per history entry ourselves.
  // Keyed by location.key (stable per history entry) in sessionStorage, scoped
  // to this document, so navigating into a nested page and back restores where
  // you were. Runs in both embedded and standalone documents — harmless either
  // way, and standalone deep links benefit too.
  const SCROLL_KEY_PREFIX = "dali:scroll:";
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = SCROLL_KEY_PREFIX + location.key;

    // Restore on entering this location. rAF waits for the new route's content
    // to paint so the target offset exists; fall back to top when unseen.
    // A REPLACE navigation is an in-place URL update on the same page — opening
    // a task drawer (`?task=`) or toggling a board filter, both via
    // `setSearchParams({ replace: true })`. React Router mints a fresh
    // location.key for it, so restoring/resetting here would yank the current
    // view to the top (the reported taskboard jump); leave scroll untouched and
    // only (re)attach the recorder below. POP restores; PUSH lands at top.
    let raf = 0;
    if (navigationType !== "REPLACE") {
      try {
        const saved = window.sessionStorage.getItem(key);
        raf = window.requestAnimationFrame(() => {
          window.scrollTo(0, saved ? parseInt(saved, 10) || 0 : 0);
        });
      } catch {
        // sessionStorage disabled — nothing to restore.
      }
    }

    // Continuously record this entry's scroll while it's the active location,
    // so a later back-navigation lands where the user left off.
    const onScroll = () => {
      try {
        window.sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        // ignore quota / disabled storage
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(raf);
      onScroll(); // capture final position for this entry before it changes
      window.removeEventListener("scroll", onScroll);
    };
  }, [location.key, navigationType]);

  // Where every routed page actually renders — inside a TabWorkspace iframe
  // (tab mode) or directly in the shell's main column (tabless mode). The
  // breadcrumb trail lives here either way: it picks up each detail route's
  // `handle.breadcrumb` for the dynamic leaf crumb.
  const pageContent = (
    <PageDocProvider>
      <div
        className={cn(
          'w-full px-3 sm:px-6 lg:px-10 pb-6 sm:pb-8',
          hasAreaSubnav ? 'pt-0' : 'pt-4 sm:pt-8 md:pt-12',
        )}
      >
        <div
          className={cn(
            'flex items-start justify-between gap-3',
            roomyBreadcrumb ? 'mb-5 sm:mb-6 empty:mb-0' : 'mb-2 empty:mb-0',
          )}
        >
          <Breadcrumbs />
          <PageDocButton suppressWhenPills />
        </div>
        <PageDocOutlet>
          <Outlet />
        </PageDocOutlet>
      </div>
    </PageDocProvider>
  )

  // Skip the sidebar shell when rendered inside a TabWorkspace iframe.
  if (embedded) {
    return <div className="min-h-dvh bg-page overflow-x-hidden">{pageContent}</div>
  }

  return (
    <>
      <Layout user={user} photoUrl={photoUrl} isCore={isCore} isAdmin={isAdmin} isDomainLead={isDomainLead} canViewForms={canViewForms} canViewStaffing={canViewStaffing} isInterviewer={isInterviewer} hasHiringAccess={hasHiringAccess} isLabMentor={isLabMentorFlag} focusMode={focus}>
        {tabless ? <div className="flex-1 overflow-x-hidden">{pageContent}</div> : undefined}
      </Layout>
      <LaunchWelcome firstName={user.firstName || user.email.split('@')[0]} hasCalendarLink={hasCalendarLink} shouldShowTour={shouldShowTour} tabless={tabless} />
      <TimeZonePrompt userTimeZone={userTimeZone} userTimeZoneIsExplicit={userTimeZoneIsExplicit} dismissedZone={tzDismissedZone} />
    </>
  )
}
