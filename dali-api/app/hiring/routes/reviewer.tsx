import React, { useState, useEffect } from 'react'
import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router'
import { CheckCircle, FileText, EyeOff, ListOrdered } from 'lucide-react'
import { getReviewStatus } from '~/hiring/lib/review-status'
import { getUserRoles } from '~/lib/roles'
import { hiringPills } from '~/hiring/components/hiringPills'
import { AreaPillNav } from '~/components/AreaPillNav'
import { CycleSelector } from '~/hiring/components/CycleSelector'
import { Section } from '~/hiring/components/Section'
import { getActiveCycle, cycleStatusToStage, inferUnderReviewStage } from '~/hiring/lib/cycles'
import { getCycleConfidentialityState } from '~/hiring/lib/confidentiality'
import { ConfidentialityGate } from '~/hiring/components/ConfidentialityGate'
import { INITIAL_COLUMNS, FINAL_COLUMNS } from '~/hiring/lib/delibs'
import { ApplicantContextModal } from '~/hiring/components/delibs/ApplicantContextModal'
import { prisma } from '~/lib/db'
import { requireAuth } from "~/lib/auth";
import { inReviewPipelineFilter } from '~/hiring/lib/application-pipeline-filter'
import type { Route } from './+types/reviewer'

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Reviews · Hiring · DALI OS" }]

export async function loader({ request }: Route.LoaderArgs) {
  const empty = {
    activeCycle: null as { id: string; name: string; cycleType: string } | null,
    availableCycles: [] as Array<{ id: string; name: string; cycleType: string }>,
    currentStage: 'challengeSetup' as ReturnType<typeof cycleStatusToStage>,
    reviewerUserId: null as string | null,
    memberId: null as string | null,
    myReviews: [] as any[],
    delibsSessions: [] as any[],
    delibsApplications: [] as any[],
    confidentialityRequired: null as null | "no_agreement" | "unsigned",
    pillRoles: null as {
      isCore: boolean
      isDomainLead: boolean
      isAdmin: boolean
      isInterviewer: boolean
    } | null,
  }

  const auth = await requireAuth(request)
  if (!auth.ok) return empty

  const roles = await getUserRoles(auth.user.sub)
  const pillRoles = {
    isCore: roles.isCore,
    isDomainLead: roles.isDomainLead,
    isAdmin: roles.isAdmin,
    isInterviewer: roles.isInterviewer,
  }
  Object.assign(empty, { pillRoles })

  const member = await prisma.dALIMember.findUnique({ where: { userId: auth.user.sub } })
  if (!member) return { ...empty, reviewerUserId: auth.user.sub }

  // The single-active-cycle invariant is per-cycleType, so a Standard and an
  // InternToFull cycle can be Open simultaneously. Probe both, collect the
  // ones the reviewer is actually assigned on, and let the user switch
  // between them via ?cycle=<id>. Default = first match (Standard preferred).
  const [standardActive, internToFullActive] = await Promise.all([
    getActiveCycle("Standard"),
    getActiveCycle("InternToFull"),
  ])
  const candidates = [standardActive, internToFullActive].filter(
    (c): c is NonNullable<typeof standardActive> => c !== null,
  )
  if (candidates.length === 0) return { ...empty, reviewerUserId: auth.user.sub }

  const assignmentsPerCycle = await Promise.all(
    candidates.map(async (c) => ({
      cycle: c,
      reviewerRows: await prisma.cycleReviewer.findMany({
        where: { userId: auth.user.sub, applicationCycleId: c.id },
        select: { id: true, domainId: true },
      }),
    })),
  )
  const onCycles = assignmentsPerCycle.filter(({ reviewerRows }) => reviewerRows.length > 0)
  if (onCycles.length === 0) return { ...empty, reviewerUserId: auth.user.sub }

  const availableCycles = onCycles.map(({ cycle }) => ({
    id: cycle.id,
    name: cycle.name,
    cycleType: cycle.cycleType as string,
  }))

  const url = new URL(request.url)
  const requested = url.searchParams.get("cycle")
  const selectedEntry =
    (requested ? onCycles.find(({ cycle }) => cycle.id === requested) : undefined) ??
    onCycles[0]
  const active = selectedEntry.cycle
  const myReviewerIds = selectedEntry.reviewerRows
  const reviewerIds = myReviewerIds.map(r => r.id)
  const myDomainIds = Array.from(new Set(myReviewerIds.map(r => r.domainId)))

  const activeCycleStatus = active.currentStatus

  const confState = await getCycleConfidentialityState(auth.user.sub, active.id)
  const confidentialityRequired =
    confState.status === "signed" ? null : confState.status

  // Only load applicant names when the user has signed the cycle's
  // confidentiality agreement. Otherwise return empty arrays and surface a
  // gate placeholder in the component.
  // Withdrawn applications stay in the DB (audit log) but should drop out of
  // the active reviewer queue. Filter the parent `application` relation so the
  // ApplicationReview rows themselves remain queryable from analytics paths.
  const myReviews = confidentialityRequired ? [] : await prisma.applicationReview.findMany({
    where: {
      cycleReviewerId: { in: reviewerIds },
      domainApplication: { application: inReviewPipelineFilter },
    },
    include: {
      domainApplication: {
        include: {
          application: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
          challengeVersion: { include: { domain: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Infer the sub-stage within UnderReview from actual data
  let currentStage = cycleStatusToStage(activeCycleStatus);
  if (activeCycleStatus === 'UnderReview') {
    currentStage = await inferUnderReviewStage(active.id, auth.user.sub, reviewerIds);
  }

  // Fetch active delibs sessions for the reviewer's domains (live mirror view).
  // Only load when signed — the session cards show applicant names.
  // Initial sessions are blinded; Final sessions show real names.
  if (confidentialityRequired) {
    return {
      activeCycle: { id: active.id, name: active.name, cycleType: active.cycleType as string },
      availableCycles,
      currentStage,
      reviewerUserId: auth.user.sub,
      memberId: member.id,
      myReviews: [],
      delibsSessions: [],
      delibsApplications: [],
      confidentialityRequired,
      pillRoles,
    }
  }

  const delibsSessionsRaw = await prisma.delibsSession.findMany({
    where: {
      applicationCycleId: active.id,
      domainId: { in: myDomainIds },
      status: "Active",
    },
    include: { domain: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  // For each session, compute the effective columnOrder the way the domain-lead
  // kanban does: read the saved columnOrder, then fill the default column with
  // every qualifying domain application that isn't already placed. Otherwise
  // apps that have never been dragged wouldn't appear in the reviewer mirror.
  const delibsSessions: any[] = [];
  const hydratedDaIds = new Set<string>();
  const daIdToSummary = new Map<string, any>();

  for (const session of delibsSessionsRaw) {
    const isInitial = session.type === "Initial";
    const cols = isInitial ? INITIAL_COLUMNS : FINAL_COLUMNS;
    const defaultCol = cols[0];

    const qualifyingFilter = isInitial
      ? {
          reviews: { every: { submittedAt: { not: null } }, some: {} },
          decisions: { none: { stage: { in: ["Final" as const, "Released" as const] } } },
        }
      : {
          interviews: { some: { status: "Completed" as const } },
        };

    const qualifying = await prisma.domainApplication.findMany({
      where: {
        selected: true,
        challengeVersion: { domainId: session.domainId },
        application: {
          applicationCycleId: session.applicationCycleId,
          ...inReviewPipelineFilter,
        },
        ...qualifyingFilter,
      },
      include: {
        application: {
          include: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });

    const qualifyingIds = new Set(qualifying.map(q => q.id));
    for (const da of qualifying) {
      hydratedDaIds.add(da.id);
      daIdToSummary.set(da.id, da);
    }

    const saved = (session.columnOrder ?? {}) as Record<string, string[]>;
    const placed = new Set<string>();
    const effective: Record<string, string[]> = {};
    for (const col of cols) {
      effective[col] = [];
      for (const id of saved[col] ?? []) {
        if (qualifyingIds.has(id) && !placed.has(id)) {
          effective[col].push(id);
          placed.add(id);
        }
      }
    }
    for (const da of qualifying) {
      if (!placed.has(da.id)) effective[defaultCol].push(da.id);
    }

    delibsSessions.push({ ...session, columnOrder: effective });
  }

  const delibsApplications = Array.from(hydratedDaIds).map(id => daIdToSummary.get(id));

  return {
      activeCycle: { id: active.id, name: active.name, cycleType: active.cycleType as string },
      availableCycles,
      currentStage,
      reviewerUserId: auth.user.sub,
      memberId: member.id,
      myReviews,
      delibsSessions,
      delibsApplications,
      confidentialityRequired: null as null | "no_agreement" | "unsigned",
      pillRoles,
    }
}

export default function ReviewerDashboard() {
  const {
    activeCycle,
    availableCycles,
    currentStage,
    myReviews,
    delibsSessions,
    delibsApplications,
    confidentialityRequired,
    pillRoles,
  } = useLoaderData<typeof loader>()

  const areaPills = pillRoles && (
    <AreaPillNav items={hiringPills({ ...pillRoles, active: 'reviews' })} />
  )

  if (!activeCycle) {
    return (
      <div className="space-y-8">
        {areaPills}
        <h1 className="text-2xl font-bold text-foreground">Reviews</h1>
        <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
          <p className="text-muted-foreground">You are not assigned as a reviewer for any active cycle.</p>
        </div>
      </div>
    )
  }

  // Bucket reviews via the shared status helper so this view and the
  // domain-lead pills agree on what counts as "in progress" vs "not started".
  const reviews = myReviews ?? []
  const submittedReviews = reviews.filter(r => getReviewStatus(r) === 'submitted')
  const inProgressReviews = reviews.filter(r => getReviewStatus(r) === 'inProgress')
  const pendingReviews = reviews.filter(r => getReviewStatus(r) === 'notStarted')

  // Poll the loader every 5s while any delibs session is visible, so column
  // moves made by the domain lead surface in this mirror view without a manual
  // refresh.
  const revalidator = useRevalidator()
  const hasActiveDelibs = (delibsSessions?.length ?? 0) > 0
  useEffect(() => {
    if (!hasActiveDelibs) return
    const t = setInterval(() => {
      if (revalidator.state === 'idle') revalidator.revalidate()
    }, 5000)
    return () => clearInterval(t)
  }, [hasActiveDelibs, revalidator])

  // ── Top-level view pills ──
  // Review always shows; Delibs only when a session is live (interviewing has
  // its own /hiring/interviews page). The active pill is in ?view=; an
  // unavailable/garbage value falls back to Review.
  const [searchParams, setSearchParams] = useSearchParams()
  const availableViews = [
    'review' as const,
    ...(hasActiveDelibs ? ['delibs' as const] : []),
  ]
  const requestedView = searchParams.get('view')
  const view = availableViews.includes(requestedView as any)
    ? (requestedView as (typeof availableViews)[number])
    : 'review'
  const setView = (next: (typeof availableViews)[number]) => {
    setSearchParams(
      (prev) => {
        prev.set('view', next)
        return prev
      },
      { replace: true },
    )
  }
  const VIEW_LABELS: Record<'review' | 'delibs', string> = {
    review: 'Review',
    delibs: 'Delibs',
  }

  // Selected delibs card → opens the same applicant-context modal the domain
  // lead uses. /full-context permits any reviewer with cycle access, so this
  // gives non-leads visibility into all reviews on apps in their domain.
  const [selectedDelibsDaId, setSelectedDelibsDaId] = useState<string | null>(null)

  // Lookup table of every domainApplication referenced in an active delibs
  // session, so we can render per-column cards from columnOrder.
  const delibsAppMap = new Map<string, any>()
  for (const da of delibsApplications ?? []) {
    delibsAppMap.set(da.id, da)
  }

  return (
    <div className="space-y-6">
      {areaPills}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Reviews
          </h1>
          <p className="mt-1 text-muted-foreground">
            Your assigned applications and live delibs.
          </p>
        </div>
        <CycleSelector cycles={availableCycles} activeId={activeCycle.id} />
      </div>

      {/* View pills — Review vs the live Delibs mirror. Delibs only gets a
          pill while a session is live; with one view the bar collapses. */}
      {availableViews.length > 1 && (
        <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
          {availableViews.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
                view === v
                  ? 'bg-accent-coral text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      )}

      {view === 'review' && (
      <Section
        title="Assigned Written Applications"
        icon={<FileText className="w-4 h-4 text-blue-600" />}
        badge={
          !confidentialityRequired && reviews.length > 0 ? (
            <span className="text-xs font-medium text-gray-500">
              {submittedReviews.length}/{reviews.length} submitted
            </span>
          ) : null
        }
      >
        {confidentialityRequired ? (
          <ConfidentialityGate
            cycleId={activeCycle.id}
            reason={confidentialityRequired}
            next="/hiring/reviewer"
          />
        ) : reviews.length === 0 ? (
          <p className="text-sm text-gray-500">
            You don't have any assigned applications yet. You'll see them here
            once your Domain Lead assigns reviewers.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex flex-col gap-3 min-h-[300px]">
              <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
                <h3 className="font-bold text-gray-700">Pending</h3>
                <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-sm text-gray-600">
                  {pendingReviews.length}
                </span>
              </div>
              {pendingReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="pending" />
              ))}
              {pendingReviews.length === 0 && (
                <div className="py-6 text-center border-2 border-dashed border-gray-300 rounded-lg bg-white/50">
                  <p className="text-sm text-gray-500 italic">No pending reviews</p>
                </div>
              )}
            </div>

            <div className="bg-blue-50/50 rounded-xl border border-blue-100 p-4 flex flex-col gap-3 min-h-[300px]">
              <div className="flex items-center justify-between border-b border-blue-200 pb-2 mb-2">
                <h3 className="font-bold text-blue-800">In Progress</h3>
                <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-blue-200 shadow-sm text-blue-700">
                  {inProgressReviews.length}
                </span>
              </div>
              {inProgressReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="inProgress" />
              ))}
              {inProgressReviews.length === 0 && (
                <div className="py-6 text-center border-2 border-dashed border-blue-200 rounded-lg bg-white/50">
                  <p className="text-sm text-blue-400 italic">None in progress</p>
                </div>
              )}
            </div>

            <div className="bg-green-50/50 rounded-xl border border-green-100 p-4 flex flex-col gap-3 min-h-[300px]">
              <div className="flex items-center justify-between border-b border-green-200 pb-2 mb-2">
                <h3 className="font-bold text-green-800">Submitted</h3>
                <span className="bg-white px-2.5 py-0.5 rounded-full text-xs font-bold border border-green-200 shadow-sm text-green-700">
                  {submittedReviews.length}
                </span>
              </div>
              {submittedReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="submitted" />
              ))}
              {submittedReviews.length === 0 && (
                <div className="py-6 text-center border-2 border-dashed border-green-200 rounded-lg bg-white/50">
                  <p className="text-sm text-green-500 italic">No submitted reviews</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Section>
      )}

      {view === 'delibs' && (
      <Section
        title="Delibs View"
        icon={<ListOrdered className="w-4 h-4 text-blue-600" />}
        badge={
          !confidentialityRequired && (delibsSessions?.length ?? 0) > 0 ? (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex items-center">
              <EyeOff className="w-3 h-3 mr-1" />
              Live · Read-only
            </span>
          ) : null
        }
      >
        {confidentialityRequired ? (
          <ConfidentialityGate
            cycleId={activeCycle.id}
            reason={confidentialityRequired}
            next="/hiring/reviewer"
          />
        ) : (delibsSessions?.length ?? 0) === 0 ? (
          <p className="text-sm text-gray-500">
            No active deliberations. Once your Domain Lead opens a delibs
            session, you'll see a live, read-only view of the buckets here.
          </p>
        ) : (
          <div className="space-y-8">
            {(delibsSessions as any[]).map((session: any) => (
              <DelibsSessionView
                key={session.id}
                session={session}
                appMap={delibsAppMap}
                onSelect={(daId) => setSelectedDelibsDaId(daId)}
              />
            ))}
          </div>
        )}
      </Section>
      )}

      {selectedDelibsDaId && (
        <ApplicantContextModal
          domainApplicationId={selectedDelibsDaId}
          onClose={() => setSelectedDelibsDaId(null)}
        />
      )}
    </div>
  )
}

const INITIAL_COLUMN_STYLES: Record<string, { label: string; classes: string; heading: string }> = {
  'No Decision': {
    label: 'No Decision',
    classes: 'border-gray-200 bg-gray-50',
    heading: 'text-gray-700',
  },
  Interview: {
    label: 'Interview',
    classes: 'border-green-200 bg-green-50/50',
    heading: 'text-green-900',
  },
  Reject: {
    label: 'Reject',
    classes: 'border-red-200 bg-red-50/50',
    heading: 'text-red-900',
  },
}

const FINAL_COLUMN_STYLES: Record<string, { label: string; classes: string; heading: string }> = {
  Accept: {
    label: 'Accept',
    classes: 'border-green-200 bg-green-50/50',
    heading: 'text-green-900',
  },
  Waitlist: {
    label: 'Waitlist',
    classes: 'border-yellow-200 bg-yellow-50/50',
    heading: 'text-yellow-900',
  },
  Reject: {
    label: 'Reject',
    classes: 'border-red-200 bg-red-50/50',
    heading: 'text-red-900',
  },
}

function DelibsSessionView({
  session,
  appMap,
  onSelect,
}: {
  session: any
  appMap: Map<string, any>
  onSelect: (domainApplicationId: string) => void
}) {
  const isInitial = session.type === 'Initial'
  const columnOrder = (session.columnOrder ?? {}) as Record<string, string[]>
  const columns = isInitial ? INITIAL_COLUMNS : FINAL_COLUMNS
  const styles = isInitial ? INITIAL_COLUMN_STYLES : FINAL_COLUMN_STYLES

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900">
          {session.domain?.name ?? 'Domain'} · {isInitial ? 'Written Delibs' : 'Final Delibs'}
        </h3>
      </div>
      <div
        className={`grid grid-cols-1 gap-4 ${columns.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
      >
        {columns.map((col) => {
          const ids = columnOrder[col] ?? []
          const style = styles[col]
          return (
            <div key={col} className={`rounded-xl border p-4 min-h-[160px] ${style.classes}`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className={`font-bold text-sm ${style.heading}`}>{style.label}</h4>
                <span className="bg-white px-2 py-0.5 rounded-full text-xs font-bold border shadow-sm">
                  {ids.length}
                </span>
              </div>
              <div className="space-y-2">
                {ids.map((id, i) => {
                  const da = appMap.get(id)
                  const user = da?.application?.user
                  const label = user ? `${user.firstName} ${user.lastName}` : 'Applicant'
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onSelect(id)}
                      className="w-full text-left bg-white p-3 rounded-md border border-gray-200 shadow-sm flex items-center gap-2 hover:shadow-md hover:border-blue-300 transition cursor-pointer"
                    >
                      {!isInitial && col === 'Waitlist' && (
                        <span className="text-gray-400 font-bold text-xs w-4">{i + 1}.</span>
                      )}
                      <span className="font-medium text-gray-900 text-sm">{label}</span>
                    </button>
                  )
                })}
                {ids.length === 0 && (
                  <div className="py-4 text-center border-2 border-dashed border-gray-300 rounded-md bg-white/50">
                    <p className="text-xs text-gray-500 italic">Empty</p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReviewCard({ review, variant }: { review: any; variant: 'pending' | 'inProgress' | 'submitted' }) {
  const da = review.domainApplication
  const user = da?.application?.user
  const domain = da?.challengeVersion?.domain
  const appId = da?.applicationId ?? da?.application?.id

  const borderClass = variant === 'submitted'
    ? 'border-green-200'
    : variant === 'inProgress'
    ? 'border-blue-200 ring-1 ring-blue-100'
    : 'border-border'

  return (
    <div className={`bg-card p-4 rounded-lg border ${borderClass} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex justify-between items-start mb-1">
        <h4 className="font-bold text-foreground">
          {user?.firstName ?? '?'} {user?.lastName ?? ''}
        </h4>
        {variant === 'submitted' && <CheckCircle className="w-4 h-4 text-green-500" />}
      </div>
      <p className="text-xs text-muted-foreground mb-3">{domain?.name ?? 'Unknown Domain'}</p>
      {variant === 'submitted' && review.overallRecommendation && (
        <p className="text-xs font-medium text-muted-foreground mb-3 bg-muted inline-block px-2 py-0.5 rounded">
          {review.overallRecommendation}
        </p>
      )}
      {appId && (
        <Link
          to={`/hiring/reviewer/application/${appId}`}
          className={`block w-full text-center px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            variant === 'pending'
              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
              : variant === 'inProgress'
              ? 'bg-accent-coral text-white hover:bg-accent-coral/90'
              : 'bg-card border border-gray-300 text-foreground/80 hover:bg-muted/50'
          }`}
        >
          {variant === 'pending' ? 'Start Review' : variant === 'inProgress' ? 'Continue Review' : 'View Review'}
        </Link>
      )}
    </div>
  )
}