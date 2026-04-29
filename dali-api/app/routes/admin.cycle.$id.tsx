import { useState, useEffect, useCallback } from 'react'
import { Form, Link, useParams, useLoaderData, redirect } from 'react-router'
import type { Route } from "./+types/admin.cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { renderEmail } from "~/lib/email";
import { Modal } from "~/components/Modal";
import { ChallengePreviewModal } from "~/components/ChallengePreviewModal";
import { Settings, Users, Calendar, AlertTriangle, Trash2, Plus, CheckCircle, ArrowRight, Circle, ChevronRight, X, LayoutDashboard, Eye } from 'lucide-react'
import { formatVersionLabel, buildVersionNumberMap } from "~/lib/formatVersion";

// ─── Types ───────────────────────────────────────────────────────────────────

interface InterviewConfig {
  id?: string
  slotDurationMinutes: number
  bufferMinutes: number
  dayStartHour: number
  dayEndHour: number
  interviewStartDate: string
  interviewEndDate: string
  timezone: string
}

interface CycleReviewer {
  id: string
  daliMember: { id: string; user?: { id: string; firstName: string; lastName: string } | null }
  domain: { id: string; name: string }
}

interface InterviewRow {
  id: string
  startTime: string
  endTime: string
  status: string
  domainApplication: {
    challengeVersion: { domain: { name: string } }
    application: { user: { firstName: string; lastName: string } }
  }
  assignments: {
    id: string
    role: string
    status: string
    cycleInterviewer: {
      daliMember: { firstName: string | null; lastName: string | null; daliEmail: string | null }
      domain: { name: string }
    }
  }[]
}

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

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.cycle?.name;
  return [{ title: `${name || "Cycle"} · Hiring lead · DALI OS` }];
};

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
      challengeVersions: { include: { challengeVersion: { include: { domain: true, challenge: true, createdBy: { select: { firstName: true, lastName: true } } } } } },
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
    include: { challenge: true, createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });

  const rubricVersionOptions = await prisma.rubricVersion.findMany({
    include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });

  const cycleApplicationReviewCount = await prisma.applicationReview.count({
    where: {
      domainApplication: {
        application: { applicationCycleId: params.id },
      },
    },
  });

  // Per-domain options + which domains already have reviews assigned (used to
  // gate rubric edits — once any domain application has a review, changing
  // the rubric out from under it would invalidate scoring).
  const domainIds: string[] = cycle.domains.map((d: any) => d.domainId);
  const domainChallengeVersions = await prisma.challengeVersion.findMany({
    where: { domainId: { in: domainIds } },
    include: { challenge: true, createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });
  const domainRubricVersions = await prisma.rubricVersion.findMany({
    include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });
  const reviewsForCycle = await prisma.applicationReview.findMany({
    where: {
      domainApplication: { application: { applicationCycleId: params.id } },
    },
    select: {
      domainApplication: {
        select: { challengeVersion: { select: { domainId: true } } },
      },
    },
  });
  const reviewedDomainIdSet = new Set<string>();
  for (const r of reviewsForCycle) {
    const did = r.domainApplication.challengeVersion.domainId;
    if (did) reviewedDomainIdSet.add(did);
  }
  const reviewedDomainIds = Array.from(reviewedDomainIdSet);

  // Final decisions ready for release (HiringLead decisions panel).
  // Exclude Finals that already have a Released child — Decision is append-only,
  // so released rows still match stage="Final" and would otherwise re-appear here
  // after the optimistic UI update is undone by a loader refetch.
  const finalDecisions = await prisma.decision.findMany({
    where: {
      stage: "Final",
      children: { none: { stage: "Released" } },
      domainApplication: {
        application: { applicationCycleId: params.id },
      },
    },
    include: {
      domainApplication: {
        include: {
          application: { include: { user: { select: { firstName: true, lastName: true, dartmouthEmail: true, netId: true } } } },
          challengeVersion: { include: { domain: { select: { name: true } } } },
        },
      },
      madeBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Email-template options + current per-cycle decision bindings + which
  // DecisionTypes already have a Released decision (used to lock those slots).
  // All versions are surfaced in the picker so a hiring lead can pin a specific
  // (older) version per cycle, mirroring how RubricVersion options work.
  const emailTemplates = await prisma.emailTemplate.findMany({
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });

  const currentDecisionEmails = await prisma.cycleDecisionEmail.findMany({
    where: { applicationCycleId: params.id },
    include: {
      emailTemplateVersion: { include: { template: { select: { name: true } } } },
    },
  });

  const releasedDecisions = await prisma.decision.findMany({
    where: {
      stage: "Released",
      domainApplication: {
        application: { applicationCycleId: params.id },
      },
    },
    select: { type: true },
    distinct: ["type"],
  });
  const releasedDecisionTypes = releasedDecisions.map((d) => d.type);

  // ChallengeVersion has no `versionNumber` column on the schema, so derive
  // one per challenge family by ranking siblings by createdAt asc. We pull
  // all sibling versions for any challenge surfaced in this loader so the
  // numbers stay stable even when only a subset is shown to the picker.
  const challengeIdsToRank = new Set<string>();
  for (const cv of generalChallengeVersions) challengeIdsToRank.add(cv.challengeId);
  for (const cv of domainChallengeVersions) challengeIdsToRank.add(cv.challengeId);
  for (const link of cycle.challengeVersions) challengeIdsToRank.add(link.challengeVersion.challengeId);
  const cvSiblings = challengeIdsToRank.size > 0
    ? await prisma.challengeVersion.findMany({
        where: { challengeId: { in: [...challengeIdsToRank] } },
        select: { id: true, challengeId: true, createdAt: true },
      })
    : [];
  const cvNumberMap = buildVersionNumberMap(cvSiblings);
  const withCvNumber = <T extends { id: string }>(cv: T) => ({
    ...cv,
    versionNumber: cvNumberMap.get(cv.id) ?? null,
  });
  const cycleWithCvNumbers = {
    ...cycle,
    challengeVersions: cycle.challengeVersions.map((link) => ({
      ...link,
      challengeVersion: withCvNumber(link.challengeVersion),
    })),
  };

  return {
    cycle: cycleWithCvNumbers,
    allDomains,
    finalDecisions,
    rubricVersionOptions,
    cycleApplicationReviewCount,
    generalChallengeVersions: generalChallengeVersions.map(withCvNumber),
    emailTemplates,
    currentDecisionEmails,
    releasedDecisionTypes,
    domainChallengeVersions: domainChallengeVersions.map(withCvNumber),
    domainRubricVersions,
    reviewedDomainIds,
  };
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
    let parsedClose: Date | null = null;
    if (closeDate) {
      // Store as end-of-day UTC so the deadline covers the entire selected date
      parsedClose = new Date(closeDate + "T23:59:59Z");
    }
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { closeDate: parsedClose },
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

  if (intent === "set-decision-email") {
    const decisionType = formData.get("decisionType") as string;
    const emailTemplateVersionId = (formData.get("emailTemplateVersionId") as string) || null;
    const validTypes = ["Rejected", "InvitedToInterview", "Accepted", "Waitlisted"] as const;
    if (!validTypes.includes(decisionType as (typeof validTypes)[number])) {
      return new Response(JSON.stringify({ error: "Invalid decision type" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    // Lock once a Released decision of this type exists for this cycle.
    const alreadyReleased = await prisma.decision.count({
      where: {
        stage: "Released",
        type: decisionType as (typeof validTypes)[number],
        domainApplication: { application: { applicationCycleId: params.id } },
      },
    });
    if (alreadyReleased > 0) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    if (emailTemplateVersionId) {
      await prisma.cycleDecisionEmail.upsert({
        where: {
          applicationCycleId_decisionType: {
            applicationCycleId: params.id,
            decisionType: decisionType as (typeof validTypes)[number],
          },
        },
        update: { emailTemplateVersionId },
        create: {
          applicationCycleId: params.id,
          decisionType: decisionType as (typeof validTypes)[number],
          emailTemplateVersionId,
        },
      });
    } else {
      await prisma.cycleDecisionEmail.deleteMany({
        where: {
          applicationCycleId: params.id,
          decisionType: decisionType as (typeof validTypes)[number],
        },
      });
    }
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

  if (intent === "hl-add-domain-challenge") {
    const domainId = formData.get("domainId") as string;
    const challengeVersionId = formData.get("challengeVersionId") as string;
    if (!domainId || !challengeVersionId) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    // Hiring lead override mirrors domain lead's window: challenge edits are
    // Draft-only because applicants see the form once the cycle is Open.
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    // Confirm the chosen version belongs to the named domain — guard against
    // form tampering linking a different domain's challenge.
    const cv = await prisma.challengeVersion.findUnique({ where: { id: challengeVersionId } });
    if (!cv || cv.domainId !== domainId) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    // Prevent linking two versions of the same underlying challenge in one cycle.
    const sameChallenge = await prisma.challengeVersionApplicationCycle.findFirst({
      where: {
        applicationCycleId: params.id!,
        challengeVersion: { challengeId: cv.challengeId, domainId },
      },
    });
    if (sameChallenge) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    const existing = await prisma.challengeVersionApplicationCycle.findUnique({
      where: { challengeVersionId_applicationCycleId: { challengeVersionId, applicationCycleId: params.id! } },
    });
    if (!existing) {
      await prisma.challengeVersionApplicationCycle.create({
        data: { challengeVersionId, applicationCycleId: params.id! },
      });
    }
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "hl-remove-domain-challenge") {
    const challengeVersionId = formData.get("challengeVersionId") as string;
    if (!challengeVersionId) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    // Refuse to remove if any DomainApplication in this cycle picked this CV.
    const inUse = await prisma.domainApplication.count({
      where: {
        challengeVersionId,
        application: { applicationCycleId: params.id! },
      },
    });
    if (inUse > 0) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    await prisma.challengeVersionApplicationCycle.deleteMany({
      where: { challengeVersionId, applicationCycleId: params.id! },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "hl-set-domain-rubric") {
    const domainId = formData.get("domainId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    if (!domainId) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    // Once any review is assigned for this domain in this cycle, the rubric
    // is locked: changing it would silently invalidate prior scores.
    const hasAssignedReviews = await prisma.applicationReview.count({
      where: {
        domainApplication: {
          challengeVersion: { domainId },
          application: { applicationCycleId: params.id },
        },
      },
    });
    if (hasAssignedReviews > 0) {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    if (rubricVersionId) {
      const rv = await prisma.rubricVersion.findUnique({
        where: { id: rubricVersionId },
      });
      if (!rv) {
        return redirect(`/hiring-lead-admin/cycle/${params.id}`);
      }
    }
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      update: { rubricVersionId },
      create: { domainId, applicationCycleId: params.id, rubricVersionId },
    });
    return redirect(`/hiring-lead-admin/cycle/${params.id}`);
  }

  if (intent === "hl-force-mark-ready" || intent === "hl-force-unmark-ready") {
    const domainId = formData.get("domainId") as string;
    const confirm = formData.get("confirm");
    if (!domainId || confirm !== "true") {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect(`/hiring-lead-admin/cycle/${params.id}`);
    }
    const isReady = intent === "hl-force-mark-ready";
    if (isReady) {
      // Marking ready without a challenge linked would let the cycle pretend
      // it's configured when advance-status would still block — surface that
      // by refusing the override here.
      const hasChallenge = await prisma.challengeVersionApplicationCycle.count({
        where: {
          applicationCycleId: params.id,
          challengeVersion: { domainId },
        },
      });
      if (hasChallenge === 0) {
        return redirect(`/hiring-lead-admin/cycle/${params.id}`);
      }
    }
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      update: { isReady },
      create: { domainId, applicationCycleId: params.id, isReady },
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

const DURATION_OPTIONS = [15, 20, 25, 30, 45, 60]
const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30]
const HOUR_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 6) // 6 AM to 8 PM

function formatHour(h: number) {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminCycleDetails() {
  const { id: cycleId } = useParams()
  const loaderData = useLoaderData<typeof loader>() as any
  const cycle = loaderData?.cycle

  // ── Interview Config state ──
  const [config, setConfig] = useState<InterviewConfig>({
    slotDurationMinutes: 30,
    bufferMinutes: 15,
    dayStartHour: 9,
    dayEndHour: 18,
    interviewStartDate: '',
    interviewEndDate: '',
    timezone: 'America/New_York',
  })
  const [configSaved, setConfigSaved] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

  // ── Reviewers state ──
  const [reviewers, setReviewers] = useState<CycleReviewer[]>([])
  const [newMemberId, setNewMemberId] = useState('')
  const [newDomainId, setNewDomainId] = useState('')
  const [allMembers, setAllMembers] = useState<{ id: string; daliEmail: string; firstName?: string | null; lastName?: string | null }[]>([])
  const [allDomains, setAllDomains] = useState<{ id: string; name: string }[]>([])

  // ── Interviewers state ──
  const [interviewers, setInterviewers] = useState<any[]>([])
  const [newInterviewerMemberId, setNewInterviewerMemberId] = useState('')
  const [newInterviewerDomainId, setNewInterviewerDomainId] = useState('')

  // ── Interviews state ──
  const [interviews, setInterviews] = useState<InterviewRow[]>([])

  // ── Cycle status ──
  const [cycleStatus, setCycleStatus] = useState<string>('Draft')
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [showOpenConfirm, setShowOpenConfirm] = useState(false)

  const STATUS_FLOW = ['Draft', 'Open', 'UnderReview', 'Completed'] as const
  const STATUS_LABELS: Record<string, string> = {
    Draft: 'Draft', Open: 'Open', UnderReview: 'Under Review', Completed: 'Completed',
  }
  const STATUS_COLORS: Record<string, string> = {
    Draft: 'bg-muted text-muted-foreground', Open: 'bg-green-100 text-green-700',
    UnderReview: 'bg-yellow-100 text-yellow-700', Completed: 'bg-blue-100 text-blue-700',
  }

  // ── Active tab ──
  const [tab, setTab] = useState<'setup' | 'config' | 'reviewers' | 'dashboard' | 'decisions'>('setup')

  // ── Decisions state ──
  const [pendingDecisions, setPendingDecisions] = useState<any[]>(loaderData?.finalDecisions ?? [])
  const [releasing, setReleasing] = useState<string | null>(null)
  const [previewDecisionId, setPreviewDecisionId] = useState<string | null>(null)

  // ── Loaders (extracted so handlers can refetch after mutations) ──
  const loadStatus = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/cycles/${cycleId}/status`, { credentials: 'include' })
      if (!r.ok) return
      const data = await r.json()
      if (data) setCycleStatus(data.currentStatus)
    } catch {}
  }, [cycleId])

  const loadConfig = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/cycles/${cycleId}/interview-config`, { credentials: 'include' })
      if (!r.ok) return
      const data = await r.json()
      if (data) {
        setConfig({
          ...data,
          interviewStartDate: data.interviewStartDate?.slice(0, 10) ?? '',
          interviewEndDate: data.interviewEndDate?.slice(0, 10) ?? '',
        })
      }
    } catch {}
  }, [cycleId])

  const loadReviewers = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/cycles/${cycleId}/reviewers`, { credentials: 'include' })
      setReviewers(r.ok ? await r.json() : [])
    } catch {}
  }, [cycleId])

  const loadMembers = useCallback(async () => {
    try {
      const r = await fetch('/api/members', { credentials: 'include' })
      setAllMembers(r.ok ? await r.json() : [])
    } catch {}
  }, [])

  const loadDomains = useCallback(async () => {
    try {
      const r = await fetch('/api/domains', { credentials: 'include' })
      setAllDomains(r.ok ? await r.json() : [])
    } catch {}
  }, [])

  const loadInterviewers = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/cycles/${cycleId}/interviewers`, { credentials: 'include' })
      setInterviewers(r.ok ? await r.json() : [])
    } catch {}
  }, [cycleId])

  const loadInterviews = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/cycles/${cycleId}/interviews`, { credentials: 'include' })
      setInterviews(r.ok ? await r.json() : [])
    } catch {}
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
        // Status transitions can change which interview rows the server returns.
        loadInterviews()
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

  // ── Load data ──
  useEffect(() => {
    if (!cycleId) return
    loadStatus()
    loadConfig()
    loadReviewers()
    loadMembers()
    loadDomains()
    loadInterviewers()
    loadInterviews()
  }, [cycleId, loadStatus, loadConfig, loadReviewers, loadMembers, loadDomains, loadInterviewers, loadInterviews])

  // ── Handlers ──

  async function saveConfig() {
    if (!cycleId) return
    setConfigSaving(true)
    try {
      const res = await fetch(`/api/cycles/${cycleId}/interview-config`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) {
        setConfigSaved(true)
        setTimeout(() => setConfigSaved(false), 2000)
      }
    } finally {
      setConfigSaving(false)
    }
  }

  async function addReviewer() {
    if (!cycleId || !newMemberId || !newDomainId) return
    const res = await fetch(`/api/cycles/${cycleId}/reviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: newMemberId, domainId: newDomainId }),
    })
    if (res.ok) {
      const reviewer = await res.json()
      setReviewers(prev => [...prev, reviewer])
      setNewMemberId('')
      setNewDomainId('')
    }
  }

  async function removeReviewer(reviewerId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setReviewers(prev => prev.filter(r => r.id !== reviewerId))
    }
  }

  async function addInterviewer() {
    if (!cycleId || !newInterviewerMemberId || !newInterviewerDomainId) return
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: newInterviewerMemberId, domainId: newInterviewerDomainId }),
    })
    if (res.ok) {
      // POST returns the bare cycleInterviewer row without daliMember/domain
      // relations; refetch so the row matches the server shape exactly.
      await loadInterviewers()
      setNewInterviewerMemberId('')
      setNewInterviewerDomainId('')
    }
  }

  async function removeInterviewer(interviewerId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/cycles/${cycleId}/interviewers`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interviewerId }),
    })
    if (res.ok) {
      setInterviewers(prev => prev.filter(i => i.id !== interviewerId))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cycle Management</h1>
        <p className="text-muted-foreground mt-1">Configure interviews for cycle <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{cycleId}</span></p>
      </div>

      {/* Cycle Status */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
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
            return hasCloseDate && domains.length > 0 && domains.every((d: any) => coveredDomainIds.has(d.domainId)) && hasGeneralForm;
          })();
          return (
            <button
              onClick={
                cycleStatus === 'UnderReview'
                  ? () => setShowCompleteConfirm(true)
                  : cycleStatus === 'Draft'
                    ? () => setShowOpenConfirm(true)
                    : () => advanceStatus()
              }
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
          onCompleted={(forced) => { setShowCompleteConfirm(false); setCycleStatus('Completed'); loadInterviews(); }}
          onError={(msg) => { setShowCompleteConfirm(false); setStatusError(msg); }}
        />
      )}

      {showOpenConfirm && (
        <OpenApplicationsConfirmModal
          cycleId={cycleId!}
          closeDate={cycle?.closeDate ? new Date(cycle.closeDate) : null}
          onClose={() => setShowOpenConfirm(false)}
          onOpened={() => { setShowOpenConfirm(false); setCycleStatus('Open'); loadInterviews(); }}
          onError={(msg) => { setShowOpenConfirm(false); setStatusError(msg); }}
        />
      )}

      {statusError && (
        <div
          role="alert"
          aria-live="polite"
          aria-atomic="true"
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
        const ready = hasCloseDate && allDomainsCovered && hasGeneralForm;
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
            </div>
            {!hasGeneralRubric && (
              <p className="text-xs text-muted-foreground border-t border-yellow-200 pt-2">
                Heads up: the general application rubric isn't set yet. You can open applications without it, but reviewers can't be assigned until a rubric is in place.
              </p>
            )}
          </div>
        );
      })()}

      {/* Reminder while Open: rubric still needed before reviewer assignment */}
      {cycleStatus === 'Open' && !cycle?.generalRubricVersionId && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-0.5">
            <p className="text-sm font-bold text-yellow-900">General application rubric not set</p>
            <p className="text-sm text-yellow-800">Set the general rubric before review begins — reviewer assignment is blocked without it.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 overflow-x-auto">
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
            className={`flex-shrink-0 md:flex-1 flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
              tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Cycle Setup Tab ── */}
      {tab === 'setup' && (
        <div className="space-y-6">
          {/* Close Date */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-6">
            <h3 className="text-sm font-bold text-foreground/80 mb-3">Application Close Date</h3>
            <Form method="post" className="flex flex-col sm:flex-row sm:items-end gap-3">
              <input type="hidden" name="intent" value="set-close-date" />
              <div className="flex-1">
                <input
                  type="date"
                  name="closeDate"
                  defaultValue={cycle?.closeDate ? new Date(cycle.closeDate).toISOString().slice(0, 10) : ''}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
              >
                Save
              </button>
            </Form>
          </div>

          {/* Domains */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-foreground/80">Domains in this Cycle</h3>
            <p className="text-xs text-muted-foreground">
              Hiring leads can override per-domain challenge, rubric, and ready-state selections set by domain leads.
            </p>
            {(cycle?.domains ?? []).length > 0 ? (
              <div className="space-y-3">
                {(cycle?.domains ?? []).map((d: any) => {
                  const linkedCvLinks = (cycle?.challengeVersions ?? []).filter(
                    (cv: any) => cv.challengeVersion?.domainId === d.domainId
                  );
                  const challengeOptions = (loaderData?.domainChallengeVersions ?? []).filter(
                    (cv: any) => cv.domainId === d.domainId,
                  );
                  const rubricOptions = loaderData?.domainRubricVersions ?? [];
                  const reviewedDomainIds: string[] = loaderData?.reviewedDomainIds ?? [];
                  const rubricLocked = reviewedDomainIds.includes(d.domainId);
                  return (
                    <DomainOverridePanel
                      key={d.domainId}
                      domain={d}
                      cycleStatus={cycleStatus}
                      linkedCvLinks={linkedCvLinks}
                      challengeOptions={challengeOptions}
                      rubricOptions={rubricOptions}
                      rubricLocked={rubricLocked}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">No domains added yet.</p>
            )}
            {cycleStatus === 'Draft' && (
              <Form method="post" className="flex items-end gap-3 pt-2 border-t border-border">
                <input type="hidden" name="intent" value="add-domain" />
                <div className="flex-1">
                  <label htmlFor="add-domain-select" className="block text-xs font-medium text-muted-foreground mb-1">Add Domain</label>
                  <select
                    id="add-domain-select"
                    name="domainId"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>Select domain...</option>
                    {(loaderData?.allDomains ?? [])
                      .filter((d: any) => !(cycle?.domains ?? []).some((cd: any) => cd.domainId === d.id))
                      .map((d: any) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                  </select>
                </div>
                <button
                  type="submit"
                  className="flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </Form>
            )}
          </div>

          {/* General Form picker */}
          <GeneralFormPicker
            currentCvId={(() => {
              const generalCv = (cycle?.challengeVersions ?? []).find((cv: any) => cv.challengeVersion?.domainId === null);
              return generalCv?.challengeVersionId ?? null;
            })()}
            currentCvLabel={(() => {
              const generalCv = (cycle?.challengeVersions ?? []).find((cv: any) => cv.challengeVersion?.domainId === null);
              if (!generalCv) return null;
              const cv = generalCv.challengeVersion;
              return formatVersionLabel({
                name: cv?.challenge?.name ?? 'Untitled',
                versionNumber: cv?.versionNumber ?? null,
                createdAt: cv?.createdAt,
                createdBy: cv?.createdBy,
              });
            })()}
            options={loaderData?.generalChallengeVersions ?? []}
            locked={cycleStatus !== 'Draft'}
          />

          {/* General Form Rubric */}
          <GeneralRubricPicker
            currentRubricVersionId={cycle?.generalRubricVersionId}
            rubricVersionOptions={loaderData?.rubricVersionOptions ?? []}
            locked={(loaderData?.cycleApplicationReviewCount ?? 0) > 0}
          />

          {/* Decision-release email bindings */}
          <DecisionEmailsSection
            emailTemplates={loaderData?.emailTemplates ?? []}
            currentDecisionEmails={loaderData?.currentDecisionEmails ?? []}
            releasedDecisionTypes={loaderData?.releasedDecisionTypes ?? []}
          />
        </div>
      )}

      {/* ── Interview Setup Tab ── */}
      {tab === 'config' && (
        <div className="space-y-6">
          {/* Interview Config */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="slot-duration" className="block text-sm font-bold text-foreground/80 mb-1">Slot Duration</label>
              <select
                id="slot-duration"
                value={config.slotDurationMinutes}
                onChange={e => setConfig(c => ({ ...c, slotDurationMinutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} minutes</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="buffer-minutes" className="block text-sm font-bold text-foreground/80 mb-1">Buffer Between Interviews</label>
              <select
                id="buffer-minutes"
                value={config.bufferMinutes}
                onChange={e => setConfig(c => ({ ...c, bufferMinutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {BUFFER_OPTIONS.map(b => <option key={b} value={b}>{b} minutes</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="day-start-hour" className="block text-sm font-bold text-foreground/80 mb-1">Day Start</label>
              <select
                id="day-start-hour"
                value={config.dayStartHour}
                onChange={e => setConfig(c => ({ ...c, dayStartHour: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="day-end-hour" className="block text-sm font-bold text-foreground/80 mb-1">Day End</label>
              <select
                id="day-end-hour"
                value={config.dayEndHour}
                onChange={e => setConfig(c => ({ ...c, dayEndHour: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="interview-start-date" className="block text-sm font-bold text-foreground/80 mb-1">Interview Start Date</label>
              <input
                id="interview-start-date"
                type="date"
                value={config.interviewStartDate}
                onChange={e => setConfig(c => ({ ...c, interviewStartDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="interview-end-date" className="block text-sm font-bold text-foreground/80 mb-1">Interview End Date</label>
              <input
                id="interview-end-date"
                type="date"
                value={config.interviewEndDate}
                onChange={e => setConfig(c => ({ ...c, interviewEndDate: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={saveConfig}
              disabled={configSaving || !config.interviewStartDate || !config.interviewEndDate}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
            >
              {configSaving ? 'Saving...' : configSaved ? 'Saved!' : 'Save Configuration'}
            </button>
            {configSaved && <CheckCircle className="w-4 h-4 text-green-500" />}
          </div>
        </div>
        </div>
      )}

      {/* ── Reviewer Roster Tab ── */}
      {tab === 'reviewers' && (
        <div className="space-y-4">
          {/* Add reviewer form */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-6">
            <h3 className="text-sm font-bold text-foreground/80 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Reviewer
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label htmlFor="reviewer-member-select" className="block text-xs font-medium text-muted-foreground mb-1">DALI Member</label>
                <select
                  id="reviewer-member-select"
                  value={newMemberId}
                  onChange={e => setNewMemberId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="reviewer-domain-select" className="block text-xs font-medium text-muted-foreground mb-1">Domain</label>
                <select
                  id="reviewer-domain-select"
                  value={newDomainId}
                  onChange={e => setNewDomainId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select domain...</option>
                  {allDomains.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={addReviewer}
                disabled={!newMemberId || !newDomainId}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Roster table */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Reviewer</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reviewers.map(r => (
                  <tr key={r.id} className="hover:bg-muted/50 transition">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {r.daliMember.user ? `${r.daliMember.user.firstName} ${r.daliMember.user.lastName}` : r.daliMember.id}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.domain.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeReviewer(r.id)} className="text-red-500 hover:text-red-700 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {reviewers.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/70"><span className="sr-only">Table empty: </span>No reviewers assigned yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          {/* Add interviewer form */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-6">
            <h3 className="text-sm font-bold text-foreground/80 mb-4 flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add Interviewer
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label htmlFor="interviewer-member-select" className="block text-xs font-medium text-muted-foreground mb-1">DALI Member</label>
                <select
                  id="interviewer-member-select"
                  value={newInterviewerMemberId}
                  onChange={e => setNewInterviewerMemberId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select member...</option>
                  {allMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.firstName && m.lastName ? `${m.firstName} ${m.lastName}` : m.daliEmail}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="interviewer-domain-select" className="block text-xs font-medium text-muted-foreground mb-1">Domain</label>
                <select
                  id="interviewer-domain-select"
                  value={newInterviewerDomainId}
                  onChange={e => setNewInterviewerDomainId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select domain...</option>
                  {allDomains.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={addInterviewer}
                disabled={!newInterviewerMemberId || !newInterviewerDomainId}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>

          {/* Interviewer roster table */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Interviewer</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {interviewers.map((i: any) => {
                  const m = i.daliMember
                  const name = m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? i.daliMemberId
                  return (
                    <tr key={i.id} className="hover:bg-muted/50 transition">
                      <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{i.domain?.name ?? ''}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => removeInterviewer(i.id)} className="text-red-500 hover:text-red-700 transition">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {interviewers.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground/70"><span className="sr-only">Table empty: </span>No interviewers assigned yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Interview Dashboard Tab ── */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Applicant</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Time</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Status</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Interviewers</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {interviews.map(interview => {
                  const isFuture = new Date(interview.startTime) > new Date()
                  const domainName = interview.domainApplication.challengeVersion.domain.name
                  const start = new Date(interview.startTime)
                  const end = new Date(interview.endTime)

                  return (
                    <tr key={interview.id} className="hover:bg-muted/50 transition">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {interview.domainApplication.application.user.firstName} {interview.domainApplication.application.user.lastName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{domainName || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                        {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                        {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                          interview.status === 'Scheduled' ? 'bg-green-100 text-green-700' :
                          interview.status === 'Completed' ? 'bg-blue-100 text-blue-700' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {interview.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {interview.assignments
                          .filter((a: any) => a.status === 'Active')
                          .map((a: any) => {
                            const m = a.cycleInterviewer.daliMember
                            const name = m.firstName && m.lastName
                              ? `${m.firstName} ${m.lastName}`
                              : m.daliEmail ?? '?'
                            const roleLabel = a.role === 'InDomain' ? a.cycleInterviewer.domain.name : 'Cross'
                            return (
                              <div key={a.id} className="flex items-center gap-1">
                                <span>{name} ({roleLabel})</span>
                                {isFuture && interview.status === 'Scheduled' && (
                                  <select
                                    className="ml-1 text-xs border border-gray-300 rounded px-1.5 py-0.5"
                                    aria-label={`Reassign ${a.role === 'InDomain' ? 'in-domain' : 'cross-domain'} interviewer`}
                                    defaultValue=""
                                    onChange={async (e) => {
                                      if (!e.target.value) return
                                      await fetch(`/api/interviews/${interview.id}/reassign`, {
                                        method: 'POST', credentials: 'include',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ assignmentId: a.id, newCycleInterviewerId: e.target.value }),
                                      })
                                      window.location.reload()
                                    }}
                                  >
                                    <option value="">Reassign...</option>
                                    {interviewers
                                      .filter((i: any) => a.role === 'InDomain'
                                        ? i.domain?.name === a.cycleInterviewer.domain.name
                                        : i.domain?.name !== domainName)
                                      .filter((i: any) => i.id !== a.cycleInterviewerId)
                                      .map((i: any) => {
                                        const im = i.daliMember
                                        const iName = im?.firstName && im?.lastName ? `${im.firstName} ${im.lastName}` : im?.daliEmail ?? i.id
                                        return <option key={i.id} value={i.id}>{iName}</option>
                                      })}
                                  </select>
                                )}
                              </div>
                            )
                          })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {/* placeholder for future actions */}
                      </td>
                    </tr>
                  )
                })}
                {interviews.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground/70"><span className="sr-only">Table empty: </span>No interviews scheduled yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Decisions Tab ── */}
      {tab === 'decisions' && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border bg-muted/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h3 className="font-bold text-foreground">Final Decisions Ready for Release</h3>
              {pendingDecisions.length > 0 && (() => {
                const boundTypes = new Set(
                  (loaderData?.currentDecisionEmails ?? []).map((b: any) => b.decisionType)
                )
                const releasable = pendingDecisions.filter((d: any) => boundTypes.has(d.type))
                const skipped = pendingDecisions.length - releasable.length
                return (
                  <button
                    onClick={async () => {
                      for (const d of releasable) {
                        await fetch(`/api/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
                      }
                      setPendingDecisions(prev => prev.filter(p => !boundTypes.has(p.type)))
                    }}
                    disabled={releasable.length === 0}
                    title={
                      skipped > 0
                        ? `${skipped} decision${skipped === 1 ? '' : 's'} skipped — no email template bound on the Setup tab`
                        : undefined
                    }
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition self-start sm:self-auto disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Release All ({releasable.length})
                    {skipped > 0 && ` — ${skipped} skipped, no template bound`}
                  </button>
                )
              })()}
            </div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Applicant</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Decision</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Made By</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingDecisions.map((d: any) => {
                  const hasBinding = (loaderData?.currentDecisionEmails ?? []).some(
                    (b: any) => b.decisionType === d.type
                  )
                  return (
                  <tr key={d.id} className="hover:bg-muted/50 transition">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {d.domainApplication.application.user.firstName} {d.domainApplication.application.user.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{d.domainApplication.challengeVersion.domain.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                        d.type === 'Accepted' ? 'bg-green-100 text-green-700' :
                        d.type === 'Rejected' ? 'bg-red-100 text-red-700' :
                        d.type === 'Waitlisted' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {d.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{d.madeBy.firstName} {d.madeBy.lastName}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewDecisionId(d.id)}
                          className="inline-flex items-center gap-1 px-3 py-1 text-sm font-medium rounded-lg border border-border bg-card hover:bg-muted/40 text-foreground transition"
                          aria-label={`Preview email for ${d.domainApplication.application.user.firstName}`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview
                        </button>
                        <button
                          onClick={async () => {
                            setReleasing(d.id)
                            await fetch(`/api/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
                            setPendingDecisions(prev => prev.filter(p => p.id !== d.id))
                            setReleasing(null)
                          }}
                          disabled={releasing === d.id || !hasBinding}
                          title={
                            !hasBinding
                              ? `No email template bound to ${d.type} in this cycle. Bind one on the Setup tab → Decision Emails before releasing.`
                              : undefined
                          }
                          className="px-3 py-1 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {releasing === d.id ? 'Releasing...' : 'Release'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
                {pendingDecisions.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground/70"><span className="sr-only">Table empty: </span>No Final decisions awaiting release.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
          {previewDecisionId && (() => {
            const d = pendingDecisions.find((x: any) => x.id === previewDecisionId)
            if (!d) return null
            const binding = (loaderData?.currentDecisionEmails ?? []).find((b: any) => b.decisionType === d.type)
            return (
              <DecisionEmailPreviewModal
                decision={d}
                binding={binding ?? null}
                onClose={() => setPreviewDecisionId(null)}
              />
            )
          })()}
        </div>
      )}
    </div>
  )
}

function DecisionEmailPreviewModal({ decision, binding, onClose }: {
  decision: any;
  binding: any | null;
  onClose: () => void;
}) {
  const firstName = decision.domainApplication.application.user.firstName ?? ''
  const domain = decision.domainApplication.challengeVersion.domain.name ?? ''
  const tmpl = binding?.emailTemplateVersion ?? null
  const rendered = tmpl ? renderEmail(tmpl, { firstName, domain }) : null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">Email preview</h2>
            <p className="text-xs text-muted-foreground break-words">
              {decision.domainApplication.application.user.firstName} {decision.domainApplication.application.user.lastName}
              {' · '}
              {decision.domainApplication.challengeVersion.domain.name}
              {' · '}
              <span className="font-medium">{decision.type}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-foreground flex-shrink-0"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-4 space-y-4">
          {tmpl ? (
            <>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From</h3>
                <p className="mt-1 text-sm text-foreground">applications@dali.dartmouth.edu</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To</h3>
                <p className="mt-1 text-sm text-foreground">
                  {decision.domainApplication.application.user.dartmouthEmail
                    ?? (decision.domainApplication.application.user.netId
                      ? `${decision.domainApplication.application.user.netId}@dartmouth.edu`
                      : '(no address on file)')}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject</h3>
                <p className="mt-1 text-sm text-foreground">{rendered?.subject ?? ''}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Body</h3>
                <div
                  className="mt-1 prose prose-sm max-w-none text-foreground"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: rendered?.html ?? '' }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Template: <span className="font-medium">{binding?.emailTemplateVersion?.template?.name}</span>
                {' '}— v{binding?.emailTemplateVersion?.versionNumber}
              </p>
            </>
          ) : (
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-4 text-sm text-orange-800">
              <p className="font-medium">No template assigned for {decision.type} in this cycle.</p>
              <p className="mt-1">Releasing this decision will not send an email. Bind a template on the Setup tab under "Decision Emails".</p>
            </div>
          )}
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-border bg-muted/30 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function CompleteConfirmModal({ cycleId, onClose, onCompleted, onError }: {
  cycleId: string;
  onClose: () => void;
  onCompleted: (forced: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [pendingInterviews, setPendingInterviews] = useState(0);
  const [undecidedApps, setUndecidedApps] = useState(0);
  const [hasBlockers, setHasBlockers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Try without force first to check for blockers
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/cycles/${cycleId}/status`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: 'Completed', force: false }),
      });
      if (res.ok) {
        // No blockers — cycle completed
        onCompleted(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && (body.pendingInterviews > 0 || body.undecidedApplications > 0)) {
        setPendingInterviews(body.pendingInterviews ?? 0);
        setUndecidedApps(body.undecidedApplications ?? 0);
        setHasBlockers(true);
      } else {
        onError(body.error ?? 'Failed to complete cycle.');
      }
      setChecking(false);
    })();
  }, [cycleId]);

  async function forceComplete() {
    setSubmitting(true);
    const res = await fetch(`/api/cycles/${cycleId}/status`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newStatus: 'Completed', force: true }),
    });
    if (res.ok) {
      onCompleted(true);
    } else {
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? 'Failed to force-complete cycle.');
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        {checking ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Checking cycle readiness...</p>
          </div>
        ) : hasBlockers ? (
          <>
            <h2 className="text-lg font-semibold text-foreground">Cycle has unfinished work</h2>
            <div className="space-y-2">
              {pendingInterviews > 0 && (
                <div className="flex items-center gap-2 text-sm bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                  <span className="font-semibold text-yellow-800">{pendingInterviews}</span>
                  <span className="text-yellow-700">interview{pendingInterviews !== 1 ? 's' : ''} not yet completed</span>
                </div>
              )}
              {undecidedApps > 0 && (
                <div className="flex items-center gap-2 text-sm bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                  <span className="font-semibold text-yellow-800">{undecidedApps}</span>
                  <span className="text-yellow-700">applicant{undecidedApps !== 1 ? 's' : ''} without a released decision</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Resolve these before completing the cycle, or force-close if you're sure.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
              >
                Go back
              </button>
              <button
                onClick={forceComplete}
                disabled={submitting}
                className="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50"
              >
                {submitting ? 'Closing...' : 'Force Close'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function OpenApplicationsConfirmModal({
  cycleId,
  closeDate,
  onClose,
  onOpened,
  onError,
}: {
  cycleId: string;
  closeDate: Date | null;
  onClose: () => void;
  onOpened: () => void;
  onError: (msg: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const headingId = `open-confirm-heading-${cycleId}`;

  async function confirmOpen() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/cycles/${cycleId}/status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStatus: 'Open' }),
      });
      if (res.ok) {
        onOpened();
        return;
      }
      const body = await res.json().catch(() => ({}));
      onError(body.error ?? `Couldn't open applications (HTTP ${res.status}).`);
    } catch (e: any) {
      onError(e?.message ?? 'Network error opening applications.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={submitting ? () => {} : onClose}
      disableEscape={submitting}
      labelledBy={headingId}
      containerClassName="bg-card rounded-2xl shadow-xl max-w-md w-full mx-4 p-6"
    >
      <div className="space-y-4">
        <h2 id={headingId} className="text-lg font-bold text-foreground">
          Open applications for this cycle?
        </h2>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            <span className="font-semibold text-foreground">This is irreversible for the cycle.</span>{' '}
            Once applications open, you can't return the cycle to Draft.
          </p>
          <p>
            The general challenge and per-domain challenges will no longer be editable while the cycle is open.
          </p>
          {closeDate && (
            <div className="bg-muted/40 rounded-lg p-3 text-xs">
              <span className="font-medium text-foreground/80">Applications close: </span>
              <span>{closeDate.toLocaleDateString()}</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmOpen}
            disabled={submitting}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50"
          >
            {submitting ? 'Opening...' : 'Open applications'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function GeneralRubricPicker({ currentRubricVersionId, rubricVersionOptions, locked }: {
  currentRubricVersionId: string | null;
  rubricVersionOptions: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(!currentRubricVersionId);
  const currentRubric = rubricVersionOptions.find((rv: any) => rv.id === currentRubricVersionId);
  const currentRubricLabel = currentRubric
    ? formatVersionLabel({
        name: currentRubric.rubric?.name ?? 'Set',
        versionNumber: currentRubric.versionNumber,
        createdAt: currentRubric.createdAt,
        createdBy: currentRubric.createdBy,
      })
    : 'Set';

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">General Application Rubric</h3>
      <p className="text-xs text-muted-foreground">Reviewers score every application against this rubric (in addition to the per-domain rubric set by domain leads).</p>

      {locked ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span>{currentRubricLabel}</span>
          <span className="text-xs text-muted-foreground/70 ml-2">(locked — reviews have started)</span>
        </div>
      ) : currentRubricVersionId && !editing ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentRubricLabel}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Change
          </button>
        </div>
      ) : (
        <Form method="post" className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="set-general-rubric" />
          <div className="flex-1">
            <select
              name="rubricVersionId"
              defaultValue={currentRubricVersionId ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No rubric assigned</option>
              {rubricVersionOptions.map((rv: any) => (
                <option key={rv.id} value={rv.id}>
                  {formatVersionLabel({
                    name: rv.rubric?.name ?? 'Rubric',
                    versionNumber: rv.versionNumber,
                    createdAt: rv.createdAt,
                    createdBy: rv.createdBy,
                  })}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          {currentRubricVersionId && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </Form>
      )}
    </div>
  );
}

function DomainOverridePanel({
  domain,
  cycleStatus,
  linkedCvLinks,
  challengeOptions,
  rubricOptions,
  rubricLocked,
}: {
  domain: any;
  cycleStatus: string;
  linkedCvLinks: any[];
  challengeOptions: any[];
  rubricOptions: any[];
  rubricLocked: boolean;
}) {
  const [showReadyModal, setShowReadyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [previewCvId, setPreviewCvId] = useState<string | null>(null);
  const [showRubricPreview, setShowRubricPreview] = useState(false);

  const challengeLocked = cycleStatus !== 'Draft';
  const readyLocked = cycleStatus !== 'Draft';
  const isReady: boolean = !!domain.isReady;
  const linkedCvs: any[] = linkedCvLinks.map((l: any) => l.challengeVersion).filter(Boolean);
  const linkedCvIds = new Set<string>(linkedCvs.map((cv: any) => cv.id));
  const linkedChallengeIds = new Set<string>(linkedCvs.map((cv: any) => cv.challengeId));
  const hasLinkedChallenge = linkedCvs.length > 0;
  const summaryLabel = !hasLinkedChallenge
    ? null
    : linkedCvs.length === 1
      ? formatVersionLabel({
          name: linkedCvs[0].challenge?.name ?? 'Untitled',
          versionNumber: linkedCvs[0].versionNumber,
          createdAt: linkedCvs[0].createdAt,
          createdBy: linkedCvs[0].createdBy,
        })
      : `${linkedCvs.length} challenges linked`;

  // Picker for adding a new CV (filtered to those not yet linked, and not a duplicate challenge)
  const addableOptions = challengeOptions.filter((cv: any) => !linkedCvIds.has(cv.id) && !linkedChallengeIds.has(cv.challengeId));
  const [pickerCvId, setPickerCvId] = useState('');
  // Reset picker when the linked set changes (after a redirect re-render)
  useEffect(() => { setPickerCvId(''); }, [linkedCvIds.size]);

  // Close the ready modal when isReady flips — same-URL redirects don't remount
  // the component so the modal state survives the round-trip without this.
  useEffect(() => { setShowReadyModal(false); }, [isReady]);

  const [selectedRubricId, setSelectedRubricId] = useState(domain.rubricVersionId ?? '');
  useEffect(() => { setSelectedRubricId(domain.rubricVersionId ?? ''); }, [domain.rubricVersionId]);

  const currentRubric = rubricOptions.find((rv: any) => rv.id === selectedRubricId);
  const currentRubricLabel = currentRubric
    ? formatVersionLabel({
        name: currentRubric.rubric?.name ?? 'Rubric',
        versionNumber: currentRubric.versionNumber,
        createdAt: currentRubric.createdAt,
        createdBy: currentRubric.createdBy,
      })
    : null;

  const previewCv = previewCvId
    ? (challengeOptions.find((cv: any) => cv.id === previewCvId) ?? linkedCvs.find((cv: any) => cv.id === previewCvId))
    : null;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{domain.domain?.name ?? domain.domainId}</span>
          {hasLinkedChallenge ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
              <CheckCircle className="w-3 h-3" /> {linkedCvs.length === 1 ? 'Challenge linked' : `${linkedCvs.length} challenges linked`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-700">
              <AlertTriangle className="w-3 h-3" /> No challenge
            </span>
          )}
          {isReady ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
              <CheckCircle className="w-3 h-3" /> Domain marked ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">
              <Circle className="w-3 h-3" /> Not ready
            </span>
          )}
        </div>
        {cycleStatus === 'Draft' && (
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="text-red-500 hover:text-red-700 transition"
            aria-label={`Remove ${domain.domain?.name ?? domain.domainId}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">
            Challenge versions {challengeLocked && <span className="text-muted-foreground/70">(locked — cycle is past Draft)</span>}
          </label>
          {linkedCvs.length > 0 && (
            <ul className="border border-border rounded-lg divide-y divide-border bg-card">
              {linkedCvs.map((cv: any) => (
                <li key={cv.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-foreground/80 truncate">
                    {formatVersionLabel({
                      name: cv.challenge?.name ?? 'Untitled',
                      versionNumber: cv.versionNumber,
                      createdAt: cv.createdAt,
                      createdBy: cv.createdBy,
                    })}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewCvId(cv.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-border hover:bg-muted/50 text-foreground/70 transition"
                    >
                      <Eye className="w-3 h-3" /> Preview
                    </button>
                    {!challengeLocked && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="hl-remove-domain-challenge" />
                        <input type="hidden" name="challengeVersionId" value={cv.id} />
                        <button
                          type="submit"
                          aria-label={`Remove ${cv.challenge?.name ?? 'challenge'}`}
                          className="text-muted-foreground hover:text-red-600 transition px-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {challengeLocked ? (
            !hasLinkedChallenge && (
              <div className="text-sm text-foreground/80 px-3 py-2 bg-muted/40 rounded-lg">
                No challenge linked
              </div>
            )
          ) : addableOptions.length === 0 ? (
            !hasLinkedChallenge && (
              <p className="text-xs text-muted-foreground/70 px-3 py-2 bg-muted/30 rounded-lg">
                No challenge versions exist for this domain. Create one on the Challenges page.
              </p>
            )
          ) : (
            <Form method="post" className="flex items-end gap-2">
              <input type="hidden" name="intent" value="hl-add-domain-challenge" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <div className="flex-1 min-w-0">
                <select
                  name="challengeVersionId"
                  value={pickerCvId}
                  onChange={(e) => setPickerCvId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  aria-label={`Add challenge version for ${domain.domain?.name ?? domain.domainId}`}
                >
                  <option value="" disabled>Add a challenge version...</option>
                  {addableOptions.map((cv: any) => (
                    <option key={cv.id} value={cv.id}>
                      {formatVersionLabel({
                        name: cv.challenge?.name ?? 'Untitled',
                        versionNumber: cv.versionNumber,
                        createdAt: cv.createdAt,
                        createdBy: cv.createdBy,
                      })}
                    </option>
                  ))}
                </select>
              </div>
              {pickerCvId && (
                <button
                  type="button"
                  onClick={() => setPreviewCvId(pickerCvId)}
                  className="flex items-center gap-1 px-2 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted/50 text-foreground/70 transition"
                >
                  <Eye className="w-3 h-3" /> Preview
                </button>
              )}
              <button
                type="submit"
                disabled={!pickerCvId}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
              >
                Add
              </button>
            </Form>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Rubric version {rubricLocked && <span className="text-muted-foreground/70">(locked — reviews assigned)</span>}
          </label>
          {rubricLocked ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-sm text-foreground/80 px-3 py-2 bg-muted/40 rounded-lg">
                {currentRubricLabel ?? 'No rubric set'}
              </div>
              {currentRubric && (
                <button
                  type="button"
                  onClick={() => setShowRubricPreview(true)}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted/50 text-foreground/70 transition"
                >
                  <Eye className="w-3 h-3" /> Preview
                </button>
              )}
            </div>
          ) : rubricOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground/70 px-3 py-2 bg-muted/30 rounded-lg">
              No rubric versions exist. Create one on the Rubrics page.
            </p>
          ) : (
            <Form method="post" className="flex items-end gap-2">
              <input type="hidden" name="intent" value="hl-set-domain-rubric" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <div className="flex-1 min-w-0">
                <select
                  name="rubricVersionId"
                  value={selectedRubricId}
                  onChange={(e) => setSelectedRubricId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  aria-label={`Select rubric version for ${domain.domain?.name ?? domain.domainId}`}
                >
                  <option value="">No rubric assigned</option>
                  {rubricOptions.map((rv: any) => (
                    <option key={rv.id} value={rv.id}>
                      {formatVersionLabel({
                        name: rv.rubric?.name ?? 'Rubric',
                        versionNumber: rv.versionNumber,
                        createdAt: rv.createdAt,
                        createdBy: rv.createdBy,
                      })}
                    </option>
                  ))}
                </select>
              </div>
              {selectedRubricId && (
                <button
                  type="button"
                  onClick={() => setShowRubricPreview(true)}
                  className="flex items-center gap-1 px-2 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted/50 text-foreground/70 transition"
                >
                  <Eye className="w-3 h-3" /> Preview
                </button>
              )}
              <button
                type="submit"
                className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
              >
                Save
              </button>
            </Form>
          )}
        </div>
      </div>

      {!readyLocked && (
        <div className="pt-2 border-t border-border flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Force-mark this domain ready to unblock cycle advancement when the domain lead is unavailable.
          </p>
          <button
            type="button"
            onClick={() => setShowReadyModal(true)}
            disabled={!isReady && !hasLinkedChallenge}
            title={!isReady && !hasLinkedChallenge ? 'Link a challenge before marking ready' : undefined}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition disabled:opacity-50 ${
              isReady
                ? 'bg-card border border-border hover:bg-muted/50 text-foreground/80'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            {isReady ? 'Unmark Ready' : 'Force Mark Ready'}
          </button>
        </div>
      )}

      {showDeleteModal && (
        <DeleteDomainModal
          domain={domain}
          onClose={() => setShowDeleteModal(false)}
        />
      )}

      {showReadyModal && (
        <ForceReadyModal
          domain={domain}
          isReady={isReady}
          selectedCvLabel={summaryLabel}
          onClose={() => setShowReadyModal(false)}
        />
      )}

      {previewCv && (
        <ChallengePreviewModal
          challengeVersionId={previewCv.id}
          challengeName={previewCv.challenge?.name ?? 'Challenge'}
          versionLabel={formatVersionLabel({
            name: previewCv.challenge?.name ?? 'Challenge',
            versionNumber: previewCv.versionNumber,
            createdAt: previewCv.createdAt,
            createdBy: previewCv.createdBy,
          })}
          description={previewCv.description}
          questions={(previewCv.questions as any[]) ?? []}
          onClose={() => setPreviewCvId(null)}
        />
      )}

      {showRubricPreview && currentRubric && (
        <RubricPreviewModal
          rv={currentRubric}
          onClose={() => setShowRubricPreview(false)}
        />
      )}
    </div>
  );
}

function ForceReadyModal({
  domain,
  isReady,
  selectedCvLabel,
  onClose,
}: {
  domain: any;
  isReady: boolean;
  selectedCvLabel: string | null;
  onClose: () => void;
}) {
  const intent = isReady ? 'hl-force-unmark-ready' : 'hl-force-mark-ready';
  const headingId = `force-ready-heading-${domain.domainId}`;
  return (
    <Modal open onClose={onClose} labelledBy={headingId} containerClassName="bg-card rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
      <div className="space-y-4">
        <h2 id={headingId} className="text-lg font-bold text-foreground">
          {isReady ? 'Unmark domain as ready?' : 'Override domain lead?'}
        </h2>
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Domain: <span className="font-semibold text-foreground">{domain.domain?.name ?? domain.domainId}</span>
          </p>
          <div className="bg-muted/40 rounded-lg p-3 text-xs">
            <span className="font-medium text-foreground/80">Challenge: </span>
            {selectedCvLabel ?? <span className="text-amber-700">none</span>}
          </div>
          {isReady ? (
            <p>This will revert the domain back to "not ready" until the domain lead (or a hiring lead) marks it ready again.</p>
          ) : (
            <p>This will mark the domain as ready on behalf of the domain lead. Use this when the domain lead is unavailable and the cycle needs to advance.</p>
          )}
        </div>
        <Form method="post" className="flex justify-end gap-2 pt-2">
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="domainId" value={domain.domainId} />
          <input type="hidden" name="confirm" value="true" />
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`px-3 py-2 text-sm font-medium rounded-md text-white ${isReady ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            {isReady ? 'Yes, unmark ready' : 'Yes, override domain lead'}
          </button>
        </Form>
      </div>
    </Modal>
  );
}

function DeleteDomainModal({ domain, onClose }: { domain: any; onClose: () => void }) {
  const headingId = `delete-domain-heading-${domain.domainId}`;
  return (
    <Modal open onClose={onClose} labelledBy={headingId} containerClassName="bg-card rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
      <div className="space-y-4">
        <h2 id={headingId} className="text-lg font-bold text-foreground">Remove domain from cycle?</h2>
        <p className="text-sm text-muted-foreground">
          Remove <span className="font-semibold text-foreground">{domain.domain?.name ?? domain.domainId}</span> from this cycle? Any linked challenge version for this domain will be unlinked.
        </p>
        <Form method="post" className="flex justify-end gap-2 pt-2">
          <input type="hidden" name="intent" value="remove-domain" />
          <input type="hidden" name="domainId" value={domain.domainId} />
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-2 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
          >
            Remove
          </button>
        </Form>
      </div>
    </Modal>
  );
}

function RubricPreviewModal({ rv, onClose }: { rv: any; onClose: () => void }) {
  const headingId = `rubric-preview-heading-${rv.id}`;
  const criteria: any[] = (rv.criteria as any[]) ?? [];
  return (
    <Modal open onClose={onClose} labelledBy={headingId} containerClassName="bg-card rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6 max-h-[80vh] overflow-y-auto">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id={headingId} className="text-lg font-bold text-foreground">
            {rv.rubric?.name ?? 'Rubric'} — v{rv.versionNumber}
          </h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        {criteria.length === 0 ? (
          <p className="text-sm text-muted-foreground/70 italic">No criteria in this version.</p>
        ) : (
          <div className="space-y-3">
            {criteria.map((c: any) => (
              <div key={c.key} className="border border-border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-foreground">{c.label}</h4>
                  <span className="text-xs text-muted-foreground">Max: {c.maxScore}</span>
                </div>
                {c.description && (
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function GeneralFormPicker({ currentCvId, currentCvLabel, options, locked }: {
  currentCvId: string | null;
  currentCvLabel: string | null;
  options: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(!currentCvId);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">General Application Form</h3>

      {locked ? (
        currentCvId ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentCvLabel}</span>
            <span className="text-xs text-muted-foreground/70 ml-2">(locked — cycle is past Draft)</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/70">No general form linked.</p>
        )
      ) : currentCvId && !editing ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentCvLabel}</span>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            Change
          </button>
        </div>
      ) : options.length > 0 ? (
        <Form method="post" className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="link-general-form" />
          <div className="flex-1">
            <select
              name="challengeVersionId"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              defaultValue={currentCvId ?? ""}
            >
              <option value="" disabled>Select a general form...</option>
              {options.map((cv: any) => (
                <option key={cv.id} value={cv.id}>
                  {formatVersionLabel({
                    name: cv.challenge?.name ?? 'Untitled',
                    versionNumber: cv.versionNumber,
                    createdAt: cv.createdAt,
                    createdBy: cv.createdBy,
                  })}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          {currentCvId && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </Form>
      ) : (
        <p className="text-xs text-muted-foreground/70">No general forms available. Create a challenge with no domain on the Challenges page first.</p>
      )}
    </div>
  );
}

const DECISION_EMAIL_SLOTS = [
  { type: "Rejected", label: "Rejected", description: "Sent when a Rejected decision is released to the applicant." },
  { type: "InvitedToInterview", label: "Invited to Interview", description: "Sent when an applicant is invited to interview." },
  { type: "Waitlisted", label: "Waitlisted", description: "Sent when an applicant is placed on the waitlist." },
  { type: "Accepted", label: "Accepted", description: "Sent when an applicant is offered a spot." },
] as const;

function DecisionEmailsSection({ emailTemplates, currentDecisionEmails, releasedDecisionTypes }: {
  emailTemplates: any[];
  currentDecisionEmails: any[];
  releasedDecisionTypes: string[];
}) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-foreground/80">Decision Emails</h3>
        <p className="text-xs text-muted-foreground">
          Pick which template fires when each decision type is released. Slots without a binding will not send an email.
          Once a decision of a given type has been released, its slot locks for this cycle.
        </p>
      </div>
      <div className="space-y-3">
        {DECISION_EMAIL_SLOTS.map((slot) => {
          const binding = currentDecisionEmails.find((b: any) => b.decisionType === slot.type);
          const locked = releasedDecisionTypes.includes(slot.type);
          return (
            <DecisionEmailPicker
              key={slot.type}
              slot={slot}
              binding={binding ?? null}
              emailTemplates={emailTemplates}
              locked={locked}
            />
          );
        })}
      </div>
    </div>
  );
}

function DecisionEmailPicker({ slot, binding, emailTemplates, locked }: {
  slot: { type: string; label: string; description: string };
  binding: any | null;
  emailTemplates: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const currentVersionId: string | null = binding?.emailTemplateVersionId ?? null;
  const currentLabel = binding
    ? `${binding.emailTemplateVersion.template.name} — v${binding.emailTemplateVersion.versionNumber}`
    : null;

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-foreground">{slot.label}</h4>
          <p className="text-xs text-muted-foreground">{slot.description}</p>
        </div>
        {!editing && !locked && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium shrink-0"
          >
            {currentLabel ? "Change" : "Assign"}
          </button>
        )}
      </div>

      {locked ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span>{currentLabel ?? "No template assigned"}</span>
          <span className="text-xs text-muted-foreground/70 ml-2">(locked — decisions of this type already released)</span>
        </div>
      ) : !editing ? (
        currentLabel ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentLabel}</span>
          </div>
        ) : (
          <div className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
            No template assigned — releasing a {slot.label} decision will not send an email.
          </div>
        )
      ) : (
        <Form method="post" className="flex items-end gap-2 flex-wrap" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="set-decision-email" />
          <input type="hidden" name="decisionType" value={slot.type} />
          <div className="flex-1 min-w-[14rem]">
            <select
              name="emailTemplateVersionId"
              defaultValue={currentVersionId ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No template (skip email)</option>
              {emailTemplates
                .filter((t: any) => t.versions.length > 0)
                .flatMap((t: any) =>
                  t.versions.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {t.name} — v{v.versionNumber}
                    </option>
                  ))
                )}
            </select>
          </div>
          <button
            type="submit"
            className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </Form>
      )}
    </div>
  );
}
