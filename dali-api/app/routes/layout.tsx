import { useEffect, useState } from 'react'
import { Outlet, redirect, useLoaderData, useLocation, useMatches, useNavigate, useSearchParams } from 'react-router'
import { cn } from '~/lib/cn'
import { Layout } from '~/components/Layout'
import { Breadcrumbs } from '~/components/Breadcrumbs'
import { PageDocButton } from '~/components/page-docs/PageDocButton'
import { LaunchWelcome } from '~/components/LaunchWelcome'
import { requireAuth, redirectPartnerToPortal } from "~/lib/auth";
import { getUserRoles, isLabMentor } from '~/lib/roles'
import { getActiveCycle } from '~/hiring/lib/cycles'
import { prisma } from '~/lib/db'
import { resolvePhotoUrl } from '~/lib/photo'
import { recordPageView } from '~/lib/analytics'
import type { Route } from './+types/layout'

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  if (!auth.ok) return redirect('/login')
  if (auth.user.type === 'applicant') return redirect('/portal')
  const partnerRedirect = await redirectPartnerToPortal(auth)
  if (partnerRedirect) return partnerRedirect

  // Onboarding is NOT a hard gate: a new member can use the whole app freely.
  // Their onboarding lives as a persistent task (the welcome notification) that
  // links to /onboarding and only clears once they finish. See welcome.server.

  const {
    isLabMember,
    isCore: core,
    isAdmin: admin,
    isDomainLead: domainLead,
    isInstructor,
    canViewForms,
    canViewStaffing,
  } = await getUserRoles(auth.user.sub)

  let isInterviewer = false
  if (isLabMember) {
    const active = await getActiveCycle()
    if (active) {
      const interviewer = await prisma.cycleInterviewer.findFirst({
        where: { userId: auth.user.sub, applicationCycleId: active.id },
      })
      isInterviewer = !!interviewer
    }
  }

  // Whether to show the Hiring tab at all. Core/Admin/DomainLead always; other
  // lab members only if they're a reviewer or interviewer on ANY cycle (not
  // just the active one — a reviewer on a past/future cycle still needs in).
  let hasHiringAccess = core || admin || domainLead
  if (!hasHiringAccess && isLabMember) {
    const [reviewer, interviewer] = await Promise.all([
      prisma.cycleReviewer.findFirst({ where: { userId: auth.user.sub }, select: { id: true } }),
      prisma.cycleInterviewer.findFirst({ where: { userId: auth.user.sub }, select: { id: true } }),
    ])
    hasHiringAccess = reviewer !== null || interviewer !== null
  }

  // Mentorship area gate: Core (with admin) + any active lab mentor. Hidden
  // from mentees and non-mentor members entirely.
  const isLabMentorFlag = isLabMember
    ? core || (await isLabMentor(auth.user.sub))
    : false

  // Drives the sidebar footer avatar. The loader runs on every shell
  // load/revalidation, so this stays in sync after a profile edit. Also tells
  // the launch tour whether to offer the "connect your calendar" step.
  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: {
      photoUrl: true,
      calendarLinks: {
        where: { provider: "Google", enabled: true },
        select: { id: true },
        take: 1,
      },
      daliMember: { select: { onboardedAt: true, tourCompletedAt: true } },
    },
  })
  const photoUrl = await resolvePhotoUrl(me?.photoUrl)
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

  // Pageview is fire-and-forget — never blocks the response.
  recordPageView({
    request,
    userId: auth.user.sub,
    sessionId: auth.sessionId,
  })

  return { user: auth.user, photoUrl, hasCalendarLink, shouldShowTour, isCore: core, isAdmin: admin, isDomainLead: domainLead, canViewForms, canViewStaffing, isInterviewer, hasHiringAccess, isInstructor, isLabMentor: isLabMentorFlag, isEmbedded }
}

export default function AppLayoutRoute() {
  const { user, photoUrl, hasCalendarLink, shouldShowTour, isCore, isAdmin, isDomainLead, canViewForms, canViewStaffing, isInterviewer, hasHiringAccess, isLabMentor: isLabMentorFlag, isEmbedded } = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const matches = useMatches()
  const navigate = useNavigate()
  const hasAreaSubnav = matches.some(
    (m) => (m as { handle?: { areaPills?: boolean } }).handle?.areaPills,
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
    let raf = 0;
    try {
      const saved = window.sessionStorage.getItem(key);
      raf = window.requestAnimationFrame(() => {
        window.scrollTo(0, saved ? parseInt(saved, 10) || 0 : 0);
      });
    } catch {
      // sessionStorage disabled — nothing to restore.
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
  }, [location.key]);

  // Skip the sidebar shell when rendered inside a TabWorkspace iframe. This is
  // where every routed page actually renders, so the breadcrumb trail (derived
  // from the iframe document's matched routes) lives here — it picks up each
  // detail route's `handle.breadcrumb` for the dynamic leaf crumb.
  if (embedded) {
    return (
      <div className="min-h-dvh bg-page overflow-x-hidden">
        <div
          className={cn(
            'w-full px-3 sm:px-6 lg:px-10 pb-6 sm:pb-8',
            hasAreaSubnav ? 'pt-0' : 'pt-4 sm:pt-8 md:pt-12',
          )}
        >
          <div className="mb-2 flex items-start justify-between gap-3 empty:mb-0">
            <Breadcrumbs />
            <PageDocButton suppressWhenPills />
          </div>
          <Outlet />
        </div>
      </div>
    )
  }

  return (
    <>
      <Layout user={user} photoUrl={photoUrl} isCore={isCore} isAdmin={isAdmin} isDomainLead={isDomainLead} canViewForms={canViewForms} canViewStaffing={canViewStaffing} isInterviewer={isInterviewer} hasHiringAccess={hasHiringAccess} isLabMentor={isLabMentorFlag} />
      <LaunchWelcome firstName={user.firstName || user.email.split('@')[0]} hasCalendarLink={hasCalendarLink} shouldShowTour={shouldShowTour} />
    </>
  )
}
