import React, { useState, useEffect } from 'react'
import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router'
import { CheckCircle, FileText, EyeOff, ListOrdered } from 'lucide-react'
import { getReviewStatus } from '~/hiring/lib/review-status'
import { getUserRoles } from '~/lib/roles'
import { hiringPills } from '~/hiring/components/hiringPills'
import { AreaPillNav } from '~/components/AreaPillNav'
import { CycleSelector } from '~/hiring/components/CycleSelector'
import { Section } from '~/hiring/components/Section'
import { PageHeader } from '~/hiring/components/PageHeader'
import { EmptyState } from '~/hiring/components/EmptyState'
import { Pill, RecommendationPill } from '~/hiring/components/Pill'
import { buttonClasses } from '~/components/ui/Button'
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
      <div className="space-y-6">
        {areaPills}
        <PageHeader title="Reviews" subtitle="Score the applications assigned to you." />
        <EmptyState
          icon={FileText}
          title="No reviews assigned yet"
          description="You're not assigned as a reviewer for any active cycle. Assignments from your domain lead will show up here."
        />
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
      <PageHeader
        title="Reviews"
        subtitle="Score the applications assigned to you, and watch live delibs."
        actions={<CycleSelector cycles={availableCycles} activeId={activeCycle.id} />}
      />

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
        title="Assigned written applications"
        icon={<FileText className="w-4 h-4 text-muted-foreground" />}
        badge={
          !confidentialityRequired && reviews.length > 0 ? (
            <span className="text-xs font-medium text-muted-foreground">
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
          <EmptyState
            icon={FileText}
            title="No applications assigned yet"
            description="Once your domain lead assigns you reviewers, your applications appear here."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ReviewColumn title="Pending" count={pendingReviews.length} emptyLabel="Nothing pending">
              {pendingReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="pending" />
              ))}
            </ReviewColumn>
            <ReviewColumn title="In progress" count={inProgressReviews.length} emptyLabel="Nothing in progress">
              {inProgressReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="inProgress" />
              ))}
            </ReviewColumn>
            <ReviewColumn title="Submitted" count={submittedReviews.length} emptyLabel="Nothing submitted yet">
              {submittedReviews.map((r: any) => (
                <ReviewCard key={r.id} review={r} variant="submitted" />
              ))}
            </ReviewColumn>
          </div>
        )}
      </Section>
      )}

      {view === 'delibs' && (
      <Section
        title="Delibs view"
        icon={<ListOrdered className="w-4 h-4 text-muted-foreground" />}
        badge={
          !confidentialityRequired && (delibsSessions?.length ?? 0) > 0 ? (
            <Pill className="gap-1">
              <EyeOff className="w-3 h-3" />
              Live · read-only
            </Pill>
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
          <EmptyState
            icon={ListOrdered}
            title="No active deliberations"
            description="When your domain lead opens a delibs session, you'll see a live, read-only view of the buckets here."
          />
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
    classes: 'border-border bg-muted/40',
    heading: 'text-foreground',
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
        <h3 className="font-heading font-semibold text-foreground">
          {session.domain?.name ?? 'Domain'} · {isInitial ? 'Written delibs' : 'Final delibs'}
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
                <h4 className={`font-heading font-semibold text-sm ${style.heading}`}>{style.label}</h4>
                <Pill>{ids.length}</Pill>
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
                      className="w-full text-left bg-card p-3 rounded-md border border-border shadow-sm flex items-center gap-2 hover:shadow-md hover:border-accent-coral/40 transition cursor-pointer"
                    >
                      {!isInitial && col === 'Waitlist' && (
                        <span className="text-muted-foreground font-bold text-xs w-4">{i + 1}.</span>
                      )}
                      <span className="font-medium text-foreground text-sm">{label}</span>
                    </button>
                  )
                })}
                {ids.length === 0 && (
                  <div className="py-4 text-center border-2 border-dashed border-border rounded-md bg-card/50">
                    <p className="text-xs text-muted-foreground italic">Empty</p>
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

// A quiet, neutral column shell for the review kanban. Boldness lives in the
// cards' single primary action, not in painted column backgrounds.
function ReviewColumn({
  title,
  count,
  emptyLabel,
  children,
}: {
  title: string
  count: number
  emptyLabel: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4 min-h-[280px]">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="font-heading text-sm font-semibold text-foreground">{title}</h3>
        <Pill>{count}</Pill>
      </div>
      {count === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        children
      )}
    </div>
  )
}

function ReviewCard({ review, variant }: { review: any; variant: 'pending' | 'inProgress' | 'submitted' }) {
  const da = review.domainApplication
  const user = da?.application?.user
  const domain = da?.challengeVersion?.domain
  const appId = da?.applicationId ?? da?.application?.id
  const name = `${user?.firstName ?? '?'} ${user?.lastName ?? ''}`.trim()

  // The in-progress card carries the one coral action — the review you should
  // pick back up. Pending and submitted stay secondary.
  const ctaLabel =
    variant === 'pending' ? 'Start review' : variant === 'inProgress' ? 'Continue review' : 'View review'
  const ctaVariant = variant === 'inProgress' ? 'primary' : 'secondary'

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start gap-2">
        <h4 className="font-heading font-semibold text-foreground">{name}</h4>
        {variant === 'submitted' && <CheckCircle className="w-4 h-4 shrink-0 text-accent-teal" />}
      </div>
      <p className="text-xs text-muted-foreground">{domain?.name ?? 'Unknown domain'}</p>
      {variant === 'submitted' && review.overallRecommendation && (
        <div>
          <RecommendationPill value={review.overallRecommendation} />
        </div>
      )}
      {appId && (
        <Link
          to={`/hiring/reviewer/application/${appId}`}
          className={buttonClasses(ctaVariant, 'sm', 'mt-1 w-full')}
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  )
}