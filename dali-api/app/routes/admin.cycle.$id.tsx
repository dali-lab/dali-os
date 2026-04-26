import { useState, useEffect } from 'react'
import { useParams, useLoaderData, redirect } from 'react-router'
import type { Route } from "./+types/admin.cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { Settings, Users, Calendar, AlertTriangle, CheckCircle, ArrowRight, Circle, LayoutDashboard } from 'lucide-react'
import { CompleteConfirmModal } from "~/components/admin-cycle/CompleteConfirmModal";
import { CycleSetupTab } from "~/components/admin-cycle/CycleSetupTab";
import { InterviewConfigTab } from "~/components/admin-cycle/InterviewConfigTab";
import { ReviewerRosterTab } from "~/components/admin-cycle/ReviewerRosterTab";
import { InterviewDashboardTab } from "~/components/admin-cycle/InterviewDashboardTab";
import { DecisionsTab } from "~/components/admin-cycle/DecisionsTab";

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_SEQUENCE = [
  "Draft",
  "Open",
  "UnderReview",
  "Completed",
] as const;

type CycleStatus = (typeof STATUS_SEQUENCE)[number];

function nextStatus(current: CycleStatus): CycleStatus | null {
  const idx = STATUS_SEQUENCE.indexOf(current);
  return idx < STATUS_SEQUENCE.length - 1 ? STATUS_SEQUENCE[idx + 1] : null;
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isHiringLead(auth.user.sub))) return redirect("/");

  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      domains: {
        include: { domain: true },
      },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      challengeVersions: { include: { challengeVersion: { include: { domain: true, challenge: true } } } },
      applications: {
        include: {
          user: true,
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domainApplications: {
            include: { challengeVersion: { include: { domain: true } } },
          },
        },
      },
    },
  });

  const allDomains = await prisma.domain.findMany({ orderBy: { name: "asc" } });

  // General challenge versions (domainId is null) for the form picker
  const generalChallengeVersions = await prisma.challengeVersion.findMany({
    where: { domainId: null },
    include: { challenge: true },
    orderBy: { createdAt: "desc" },
  });

  const rubricVersionOptions = await prisma.rubricVersion.findMany({
    where: { rubric: { domainId: null } },
    include: { rubric: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const cycleApplicationReviewCount = await prisma.applicationReview.count({
    where: {
      domainApplication: {
        application: { applicationCycleId: params.id },
      },
    },
  });

  // Final decisions ready for release (HiringLead decisions panel)
  const finalDecisions = await prisma.decision.findMany({
    where: {
      stage: "Final",
      domainApplication: {
        application: { applicationCycleId: params.id },
      },
    },
    include: {
      domainApplication: {
        include: {
          application: { include: { user: { select: { firstName: true, lastName: true } } } },
          challengeVersion: { include: { domain: { select: { name: true } } } },
        },
      },
      madeBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return { cycle, allDomains, finalDecisions, rubricVersionOptions, cycleApplicationReviewCount, generalChallengeVersions };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isHiringLead(auth.user.sub))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const user = await prisma.user.findUnique({ where: { id: auth.user.sub } });
  if (!user) return new Response(JSON.stringify({ error: "User not found" }), { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "set-close-date") {
    const closeDate = formData.get("closeDate") as string;
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { closeDate: closeDate ? new Date(closeDate) : null },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "set-general-rubric") {
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    const hasAssignedReviews = await prisma.applicationReview.count({
      where: {
        domainApplication: {
          application: { applicationCycleId: params.id },
        },
      },
    });
    if (hasAssignedReviews > 0) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { generalRubricVersionId: rubricVersionId },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "link-general-form") {
    const challengeVersionId = formData.get("challengeVersionId") as string;
    if (!challengeVersionId) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    // Remove any existing general form link (domainId is null)
    const existing = await prisma.challengeVersionApplicationCycle.findMany({
      where: { applicationCycleId: params.id },
      include: { challengeVersion: true },
    });
    for (const e of existing) {
      if (e.challengeVersion.domainId === null) {
        await prisma.challengeVersionApplicationCycle.delete({
          where: { challengeVersionId_applicationCycleId: { challengeVersionId: e.challengeVersionId, applicationCycleId: params.id } },
        });
      }
    }
    // Link the new one
    await prisma.challengeVersionApplicationCycle.create({
      data: { challengeVersionId, applicationCycleId: params.id },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "remove-domain" || intent === "add-domain") {
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return new Response(JSON.stringify({ error: "Domains can only be modified in Draft" }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    const domainId = formData.get("domainId") as string;
    if (intent === "remove-domain") {
      await prisma.domainApplicationCycle.delete({
        where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      });
    } else {
      await prisma.domainApplicationCycle.create({
        data: { domainId, applicationCycleId: params.id },
      });
    }
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "advance-status") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        domains: true,
        challengeVersions: { include: { challengeVersion: true } },
      },
    });

    const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
    const next = nextStatus(currentStatus as CycleStatus);
    if (!next) return null;

    if (currentStatus === "Draft") {
      const hasCloseDate = !!cycle.closeDate;
      const coveredDomainIds = new Set(
        cycle.challengeVersions.map((cv) => cv.challengeVersion.domainId)
      );
      const allDomainsCovered = cycle.domains.length > 0 && cycle.domains.every((d) => coveredDomainIds.has(d.domainId));
      if (!hasCloseDate || !allDomainsCovered) return null;
    }

    await prisma.applicationCycleStatusUpdate.create({
      data: {
        newStatus: next,
        applicationCycleId: params.id,
        userId: user.id,
      },
    });
  }

  return redirect(`/hiring-lead-admin/cycle/${params.id}`);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminCycleDetails() {
  const { id: cycleId } = useParams()
  const loaderData = useLoaderData<typeof loader>() as any
  const cycle = loaderData?.cycle

  const [cycleStatus, setCycleStatus] = useState<string>('Draft')
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [tab, setTab] = useState<'setup' | 'config' | 'reviewers' | 'dashboard' | 'decisions'>('setup')

  const STATUS_FLOW = ['Draft', 'Open', 'UnderReview', 'Completed'] as const
  const STATUS_LABELS: Record<string, string> = {
    Draft: 'Draft', Open: 'Open', UnderReview: 'Under Review', Completed: 'Completed',
  }
  const STATUS_COLORS: Record<string, string> = {
    Draft: 'bg-muted text-muted-foreground', Open: 'bg-green-100 text-green-700',
    UnderReview: 'bg-yellow-100 text-yellow-700', Completed: 'bg-blue-100 text-blue-700',
  }

  useEffect(() => {
    if (!cycleId) return
    fetch(`/api/cycles/${cycleId}/status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setCycleStatus(data.currentStatus) })
      .catch(() => {})
  }, [cycleId])

  async function advanceStatus(force = false) {
    if (!cycleId) return
    const idx = STATUS_FLOW.indexOf(cycleStatus as any)
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return
    const next = STATUS_FLOW[idx + 1]
    setStatusUpdating(true)
    setStatusError(null)
    try {
      const res = await fetch(`/api/cycles/${cycleId}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: next, force }),
      })
      if (res.ok) {
        setCycleStatus(next)
      } else {
        const body = await res.json().catch(() => ({}))
        setStatusError(
          body.error ??
            `Couldn't advance to ${STATUS_LABELS[next] ?? next} (HTTP ${res.status}).`,
        )
      }
    } catch (e: any) {
      setStatusError(e?.message ?? 'Network error advancing status.')
    } finally {
      setStatusUpdating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cycle Management</h1>
        <p className="text-muted-foreground mt-1">Configure interviews for cycle <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{cycleId}</span></p>
      </div>

      {/* Cycle Status */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Status:</span>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[cycleStatus]}`}>
            {STATUS_LABELS[cycleStatus] ?? cycleStatus}
          </span>
        </div>
        {STATUS_FLOW.indexOf(cycleStatus as any) < STATUS_FLOW.length - 1 && (() => {
          const draftChecklistMet = cycleStatus !== 'Draft' || (() => {
            const hasCloseDate = !!cycle?.closeDate;
            const domains = cycle?.domains ?? [];
            const challengeVersions = cycle?.challengeVersions ?? [];
            const coveredDomainIds = new Set(challengeVersions.map((cv: any) => cv.challengeVersion?.domainId));
            const hasGeneralForm = challengeVersions.some((cv: any) => cv.challengeVersion?.domainId === null);
            const hasGeneralRubric = !!cycle?.generalRubricVersionId;
            return hasCloseDate && domains.length > 0 && domains.every((d: any) => coveredDomainIds.has(d.domainId)) && hasGeneralForm && hasGeneralRubric;
          })();
          return (
            <button
              onClick={cycleStatus === 'UnderReview' ? () => setShowCompleteConfirm(true) : () => advanceStatus()}
              disabled={statusUpdating || !draftChecklistMet}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
            >
              {statusUpdating ? 'Updating...' : cycleStatus === 'Draft' ? 'Open Applications' : cycleStatus === 'Open' ? 'Close Applications' : 'Mark as Completed'}
              <ArrowRight className="w-4 h-4" />
            </button>
          );
        })()}
      </div>

      {showCompleteConfirm && (
        <CompleteConfirmModal
          cycleId={cycleId!}
          onClose={() => setShowCompleteConfirm(false)}
          onCompleted={() => { setShowCompleteConfirm(false); setCycleStatus('Completed'); }}
          onError={(msg) => { setShowCompleteConfirm(false); setStatusError(msg); }}
        />
      )}

      {statusError && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-900">Couldn't advance cycle status</p>
            <p className="text-sm text-red-800 mt-0.5">{statusError}</p>
          </div>
          <button
            onClick={() => setStatusError(null)}
            className="text-red-600 hover:text-red-800 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Draft Checklist */}
      {cycleStatus === 'Draft' && (() => {
        const hasCloseDate = !!cycle?.closeDate;
        const domains = cycle?.domains ?? [];
        const challengeVersions = cycle?.challengeVersions ?? [];
        const coveredDomainIds = new Set(challengeVersions.map((cv: any) => cv.challengeVersion?.domainId));
        const allDomainsCovered = domains.length > 0 && domains.every((d: any) => coveredDomainIds.has(d.domainId));
        const hasGeneralForm = challengeVersions.some((cv: any) => cv.challengeVersion?.domainId === null);
        const hasGeneralRubric = !!cycle?.generalRubricVersionId;
        const ready = hasCloseDate && allDomainsCovered && hasGeneralForm && hasGeneralRubric;
        return (
          <div className={`rounded-xl border p-4 space-y-3 ${ready ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
            <h3 className="text-sm font-bold text-foreground">Checklist to Open Applications</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                {hasCloseDate
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={hasCloseDate ? 'text-green-800' : 'text-muted-foreground'}>Close date is set</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {allDomainsCovered
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={allDomainsCovered ? 'text-green-800' : 'text-muted-foreground'}>
                  Every domain has a challenge version linked
                  {domains.length === 0 && ' (no domains added)'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {hasGeneralForm
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={hasGeneralForm ? 'text-green-800' : 'text-muted-foreground'}>General application form is linked</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {hasGeneralRubric
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={hasGeneralRubric ? 'text-green-800' : 'text-muted-foreground'}>General application rubric is set</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1">
        {([
          { key: 'setup' as const, label: 'Cycle Setup', icon: LayoutDashboard },
          { key: 'config' as const, label: 'Interview Setup', icon: Settings },
          { key: 'reviewers' as const, label: 'Reviewer Roster', icon: Users },
          { key: 'dashboard' as const, label: 'Interview Dashboard', icon: Calendar },
          { key: 'decisions' as const, label: 'Decisions', icon: CheckCircle },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'setup' && <CycleSetupTab cycle={cycle} cycleStatus={cycleStatus} loaderData={loaderData} />}
      {tab === 'config' && cycleId && <InterviewConfigTab cycleId={cycleId} />}
      {tab === 'reviewers' && cycleId && <ReviewerRosterTab cycleId={cycleId} />}
      {tab === 'dashboard' && cycleId && <InterviewDashboardTab cycleId={cycleId} />}
      {tab === 'decisions' && <DecisionsTab initialDecisions={loaderData?.finalDecisions ?? []} />}
    </div>
  )
}
