import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Form, Link, useParams, useLoaderData, redirect } from 'react-router'
import type { Route } from "./+types/lead.cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { renderEmail } from "~/lib/email";
import {
  TEMPLATE_VARIABLES,
  decisionSlot,
  notificationSlot,
  lintTemplate,
  type TemplateSlot,
  type DecisionSlotType,
  type NotificationSlotType,
} from "~/hiring/lib/email-variables";
import { Modal } from "~/components/Modal";
import { ChallengePreviewModal } from "~/hiring/components/ChallengePreviewModal";
import { Settings, Users, Calendar, AlertTriangle, Trash2, Plus, CheckCircle, ArrowRight, Circle, ChevronRight, X, LayoutDashboard, Eye, Mail } from 'lucide-react'
import { formatVersionLabel, buildVersionNumberMap } from "~/lib/formatVersion";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { sendExtensionNoticeIfDue, resendExtensionNotice } from "~/hiring/lib/extension-notice";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { zonedDayStartUtc, zonedDayEndUtc, getZonedYMD } from "~/lib/timezone";

const APPLICATION_TZ = "America/New_York";
const APPLICATION_TZ_LABEL = "ET";

// ─── Types ───────────────────────────────────────────────────────────────────

interface InterviewConfig {
  id?: string
  slotDurationMinutes: number
  bufferMinutes: number
  dayStartHour: number
  dayEndHour: number
  interviewStartDate: string
  interviewEndDate: string
  rescheduleNoticeHours: number
  cancelNoticeHours: number
  timezone: string
}

interface CycleReviewer {
  id: string
  user: { 
    id: string
    firstName: string | null
    lastName: string | null
    daliEmail: string | null
   }
  domain: { id: string; name: string }
}

interface InterviewRow {
  id: string
  startTime: string
  endTime: string
  status: string
  location: string
  zoomJoinUrl: string | null
  domainApplication: {
    challengeVersion: { domain: { name: string } }
    application: { user: { firstName: string; lastName: string } }
  }
  assignments: {
    id: string
    role: string
    status: string
    cycleInterviewer: {
      user: {  firstName: string | null; lastName: string | null; daliEmail: string | null  }
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

  // InternToFull cycles use a separate, simpler setup page (no challenges,
  // no interview config). Forward there before any of the Standard-cycle
  // payload is loaded.
  const cycleTypeRow = await prisma.applicationCycle.findUnique({
    where: { id: params.id },
    select: { cycleType: true },
  });
  if (cycleTypeRow?.cycleType === "InternToFull") {
    return redirect(`/hiring/lead/intern-to-full-cycle/${params.id}`);
  }

  // Hiring leads must be able to reach this page to bind a confidentiality
  // agreement to the cycle, so we don't redirect when unsigned. Instead, the
  // loader strips every sensitive payload — applicant identities, final
  // decisions, review counts — and the UI shows a placeholder where those
  // panels would be.
  const confState = await getCycleConfidentialityState(auth.user.sub, params.id);
  const confidentialityRequired =
    confState.status === "signed" ? null : confState.status;

  // Lazy trigger for the deadline-extension notice blast (idempotent,
  // best-effort). Mirrors how autoCloseIfExpired runs from the cycle status
  // loader: leads loading their cycle page will wake up the blast if the
  // original close has just passed.
  await sendExtensionNoticeIfDue(params.id!);

  const cycleBase = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      domains: {
        include: { domain: true },
      },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      challengeVersions: { include: { challengeVersion: { include: { domain: true, challenge: true, createdBy: { select: { firstName: true, lastName: true } } } } } },
    },
  });
  const applications = confidentialityRequired
    ? []
    : await prisma.application.findMany({
        where: { applicationCycleId: params.id },
        include: {
          user: true,
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domainApplications: {
            where: { selected: true },
            include: { challengeVersion: { include: { domain: true } } },
          },
        },
      });
  const cycle = { ...cycleBase, applications };

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

  const confidentialityAgreementOptions = await prisma.confidentialityAgreement.findMany({
    include: { versions: { orderBy: { versionNumber: "desc" } } },
    orderBy: { name: "asc" },
  });
  const currentConfidentialityBinding = await prisma.cycleConfidentialityAgreement.findUnique({
    where: { applicationCycleId: params.id },
    include: {
      confidentialityAgreementVersion: {
        include: { agreement: { select: { name: true } } },
      },
    },
  });
  const confidentialitySignatures = await prisma.confidentialityAgreementSignature.findMany({
    where: { applicationCycleId: params.id },
    include: { user: { select: { firstName: true, lastName: true } } },
    orderBy: { signedAt: "asc" },
  });

  // Even the count of reviews on this cycle is sensitive — it tells anyone
  // pre-signature how far review has progressed. Zero it out when unsigned;
  // the only reader is the rubric-locking UI, which fail-closed locks edits
  // when reviews exist (count > 0). With confidentialityRequired set, the
  // reviewer dashboard is gated anyway, so the rubric lock state is moot.
  const cycleApplicationReviewCount = confidentialityRequired
    ? 0
    : await prisma.applicationReview.count({
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
  const reviewsForCycle = confidentialityRequired
    ? []
    : await prisma.applicationReview.findMany({
        where: {
          domainApplication: { application: { applicationCycleId: params.id } },
        },
        select: {
          domainApplication: {
            select: {
              domainId: true,
              challengeVersion: { select: { domainId: true } },
            },
          },
        },
      });
  const reviewedDomainIdSet = new Set<string>();
  for (const r of reviewsForCycle) {
    const did = r.domainApplication.challengeVersion?.domainId ?? r.domainApplication.domainId ?? null;
    if (did) reviewedDomainIdSet.add(did);
  }
  const reviewedDomainIds = Array.from(reviewedDomainIdSet);

  // Final decisions ready for release (HiringLead decisions panel).
  // Exclude Finals that already have a Released child — Decision is append-only,
  // so released rows still match stage="Final" and would otherwise re-appear here
  // after the optimistic UI update is undone by a loader refetch.
  const finalDecisions = confidentialityRequired
    ? []
    : await prisma.decision.findMany({
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

  const currentNotificationEmails = await prisma.cycleNotificationEmail.findMany({
    where: { applicationCycleId: params.id },
    include: {
      emailTemplateVersion: { include: { template: { select: { name: true } } } },
    },
  });

  const releasedDecisions = confidentialityRequired
    ? []
    : await prisma.decision.findMany({
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
      currentNotificationEmails,
      releasedDecisionTypes,
      domainChallengeVersions: domainChallengeVersions.map(withCvNumber),
      domainRubricVersions,
      reviewedDomainIds,
      confidentialityAgreementOptions,
      currentConfidentialityBinding,
      confidentialitySignatures,
      confidentialityRequired,
    };
}

// ─── Action ──────────────────────────────────────────────────────────────────

/**
 * If the cycle has materialized as UnderReview (auto-close ran or a lead
 * force-closed) and the new closeDate is in the future, write a fresh Open
 * status update so the applicant portal stops showing the closed view.
 * Returns true if a reopen was written. Skips Completed (terminal) and Draft
 * (cycle was never opened — bumping the date is enough on its own).
 */
async function reopenIfNeeded(
  tx: any,
  cycleId: string,
  cycleSnapshot: { statusUpdates: { newStatus: string }[] } | null,
  newCloseDate: Date | null,
  userId: string,
): Promise<boolean> {
  if (!newCloseDate) return false;
  if (newCloseDate.getTime() <= Date.now()) return false;
  const latestStatus = cycleSnapshot?.statusUpdates[0]?.newStatus;
  if (latestStatus !== "UnderReview") return false;
  await tx.applicationCycleStatusUpdate.create({
    data: { applicationCycleId: cycleId, newStatus: "Open", userId },
  });
  return true;
}

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
      // Deadline is 11:59:59 PM Eastern on the selected date so applicants get
      // the full day in the lab's local time (not late evening UTC).
      const [y, m, d] = closeDate.split("-").map(Number);
      parsedClose = zonedDayEndUtc(y, m, d, APPLICATION_TZ);
    }
    const cycle = await prisma.applicationCycle.findUnique({
      where: { id: params.id },
      include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    // The picker represents the lead's intended/original close date. If an
    // extension is currently active, preserve the extension delta so the
    // effective close moves with the picker. If not, the picker just becomes
    // the close date.
    let nextClose: Date | null = parsedClose;
    let nextOriginal: Date | null = null;
    if (parsedClose && cycle?.originalCloseDate && cycle?.closeDate) {
      const deltaMs = cycle.closeDate.getTime() - cycle.originalCloseDate.getTime();
      nextClose = new Date(parsedClose.getTime() + deltaMs);
      nextOriginal = parsedClose;
    }
    const reopened = await prisma.$transaction(async (tx) => {
      await tx.applicationCycle.update({
        where: { id: params.id },
        data: { closeDate: nextClose, originalCloseDate: nextOriginal },
      });
      return await reopenIfNeeded(tx, params.id!, cycle, nextClose, auth.user.sub);
    });
    const notice = parsedClose
      ? (reopened ? "deadline-set-reopened" : "deadline-set")
      : "deadline-cleared";
    return redirect(`/hiring/lead/cycle/${params.id}?notice=${notice}`);
  }

  if (intent === "extend-close-date") {
    const amountRaw = formData.get("amount") as string;
    const unit = formData.get("unit") as string;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return new Response(JSON.stringify({ error: "Extension amount must be positive." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (unit !== "hours" && unit !== "days") {
      return new Response(JSON.stringify({ error: "Extension unit must be hours or days." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const cycle = await prisma.applicationCycle.findUnique({
      where: { id: params.id },
      include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!cycle?.closeDate) {
      return new Response(JSON.stringify({ error: "Set a close date before extending." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    // Set-total semantics: the amount is the *total* extension from the
    // original anchor, not additive. So calling extend(48h) twice in a row is
    // idempotent — the deadline ends up 48h past the original, not 96h. This
    // matches the UI which shows the current extension as state.
    const anchor = cycle.originalCloseDate ?? cycle.closeDate;
    const ms = unit === "hours" ? amount * 3_600_000 : amount * 86_400_000;
    const nextClose = new Date(anchor.getTime() + ms);
    const reopened = await prisma.$transaction(async (tx) => {
      await tx.applicationCycle.update({
        where: { id: params.id },
        data: { closeDate: nextClose, originalCloseDate: anchor },
      });
      return await reopenIfNeeded(tx, params.id!, cycle, nextClose, auth.user.sub);
    });
    const notice = reopened ? "extended-reopened" : "extended";
    return redirect(`/hiring/lead/cycle/${params.id}?notice=${notice}`);
  }

  if (intent === "remove-extension") {
    const cycle = await prisma.applicationCycle.findUnique({
      where: { id: params.id },
    });
    if (!cycle?.originalCloseDate) {
      // No extension to remove — just no-op.
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    await prisma.applicationCycle.update({
      where: { id: params.id },
      // Snap back to the original deadline; clear the extension marker.
      // extensionNoticeSentAt is also cleared so a future re-extension can
      // re-trigger the notice blast.
      data: {
        closeDate: cycle.originalCloseDate,
        originalCloseDate: null,
        extensionNoticeSentAt: null,
      },
    });
    return redirect(`/hiring/lead/cycle/${params.id}?notice=extension-removed`);
  }

  if (intent === "resend-extension-notice") {
    const result = await resendExtensionNotice(params.id!);
    let notice: string;
    if (result.outcome === "no_extension") {
      notice = "extension-notice-no-extension";
    } else if (result.outcome === "preflight_skipped") {
      notice = "extension-notice-not-configured";
    } else if (result.attempted === 0) {
      notice = "extension-notice-noop";
    } else if (result.succeeded === 0 && result.alreadySent === result.attempted) {
      notice = "extension-notice-all-sent";
    } else if (result.failed > 0) {
      notice = "extension-notice-partial";
    } else {
      notice = "extension-notice-sent";
    }
    return redirect(`/hiring/lead/cycle/${params.id}?notice=${notice}&sent=${result.succeeded}&failed=${result.failed}&skipped=${result.alreadySent}`);
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
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { generalRubricVersionId: rubricVersionId },
    });
    return redirect(`/hiring/lead/cycle/${params.id}`);
  }

  if (intent === "set-confidentiality-agreement") {
    const versionId =
      (formData.get("confidentialityAgreementVersionId") as string) || null;
    if (versionId) {
      await prisma.cycleConfidentialityAgreement.upsert({
        where: { applicationCycleId: params.id },
        update: { confidentialityAgreementVersionId: versionId },
        create: {
          applicationCycleId: params.id,
          confidentialityAgreementVersionId: versionId,
        },
      });
    } else {
      await prisma.cycleConfidentialityAgreement.deleteMany({
        where: { applicationCycleId: params.id },
      });
    }
    return redirect(`/hiring/lead/cycle/${params.id}`);
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
      return redirect(`/hiring/lead/cycle/${params.id}`);
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
    return redirect(`/hiring/lead/cycle/${params.id}`);
  }

  if (intent === "set-notification-email") {
    const notificationType = formData.get("notificationType") as string;
    const emailTemplateVersionId = (formData.get("emailTemplateVersionId") as string) || null;
    const validTypes = ["ApplicationReceived", "ApplicationExtensionNotice", "InterviewInviteMentor", "InterviewConfirmedApplicant", "InterviewCancelledApplicant", "InterviewCancelledInterviewer", "InterviewLocationChanged"] as const;
    if (!validTypes.includes(notificationType as (typeof validTypes)[number])) {
      return new Response(JSON.stringify({ error: "Invalid notification type" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    if (emailTemplateVersionId) {
      await prisma.cycleNotificationEmail.upsert({
        where: {
          applicationCycleId_notificationType: {
            applicationCycleId: params.id,
            notificationType: notificationType as (typeof validTypes)[number],
          },
        },
        update: { emailTemplateVersionId },
        create: {
          applicationCycleId: params.id,
          notificationType: notificationType as (typeof validTypes)[number],
          emailTemplateVersionId,
        },
      });
    } else {
      await prisma.cycleNotificationEmail.deleteMany({
        where: {
          applicationCycleId: params.id,
          notificationType: notificationType as (typeof validTypes)[number],
        },
      });
    }
    return redirect(`/hiring/lead/cycle/${params.id}`);
  }

  if (intent === "link-general-form") {
    const challengeVersionId = formData.get("challengeVersionId") as string;
    if (!challengeVersionId) {
      return redirect(`/hiring/lead/cycle/${params.id}`);
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
    return redirect(`/hiring/lead/cycle/${params.id}`);
  }

  if (intent === "hl-add-domain-challenge") {
    const domainId = formData.get("domainId") as string;
    const challengeVersionId = formData.get("challengeVersionId") as string;
    if (!domainId || !challengeVersionId) {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    // Hiring lead override mirrors domain lead's window: challenge edits are
    // Draft-only because applicants see the form once the cycle is Open.
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    // Confirm the chosen version belongs to the named domain — guard against
    // form tampering linking a different domain's challenge.
    const cv = await prisma.challengeVersion.findUnique({ where: { id: challengeVersionId } });
    if (!cv || cv.domainId !== domainId) {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    // Prevent linking two versions of the same underlying challenge in one cycle.
    const sameChallenge = await prisma.challengeVersionApplicationCycle.findFirst({
      where: {
        applicationCycleId: params.id!,
        challengeVersion: { challengeId: cv.challengeId, domainId },
      },
    });
    if (sameChallenge) {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    const existing = await prisma.challengeVersionApplicationCycle.findUnique({
      where: { challengeVersionId_applicationCycleId: { challengeVersionId, applicationCycleId: params.id! } },
    });
    if (!existing) {
      await prisma.challengeVersionApplicationCycle.create({
        data: { challengeVersionId, applicationCycleId: params.id! },
      });
    }
    return redirect(`/hiring/lead/cycle/${params.id}`);
  }

  if (intent === "hl-remove-domain-challenge") {
    const challengeVersionId = formData.get("challengeVersionId") as string;
    if (!challengeVersionId) {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    // Refuse to remove if any DomainApplication in this cycle picked this CV.
    const inUse = await prisma.domainApplication.count({
      where: {
        challengeVersionId,
        application: { applicationCycleId: params.id! },
      },
    });
    if (inUse > 0) {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    await prisma.challengeVersionApplicationCycle.deleteMany({
      where: { challengeVersionId, applicationCycleId: params.id! },
    });
    return redirect(`/hiring/lead/cycle/${params.id}`);
  }

  if (intent === "hl-set-domain-rubric") {
    const domainId = formData.get("domainId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    if (!domainId) {
      return redirect(`/hiring/lead/cycle/${params.id}`);
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
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    if (rubricVersionId) {
      const rv = await prisma.rubricVersion.findUnique({
        where: { id: rubricVersionId },
      });
      if (!rv) {
        return redirect(`/hiring/lead/cycle/${params.id}`);
      }
    }
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      update: { rubricVersionId },
      create: { domainId, applicationCycleId: params.id, rubricVersionId },
    });
    return redirect(`/hiring/lead/cycle/${params.id}`);
  }

  if (intent === "hl-force-mark-ready" || intent === "hl-force-unmark-ready") {
    const domainId = formData.get("domainId") as string;
    const confirm = formData.get("confirm");
    if (!domainId || confirm !== "true") {
      return redirect(`/hiring/lead/cycle/${params.id}`);
    }
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return redirect(`/hiring/lead/cycle/${params.id}`);
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
        return redirect(`/hiring/lead/cycle/${params.id}`);
      }
    }
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      update: { isReady },
      create: { domainId, applicationCycleId: params.id, isReady },
    });
    return redirect(`/hiring/lead/cycle/${params.id}`);
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
    return redirect(`/hiring/lead/cycle/${params.id}`);
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

  return redirect(`/hiring/lead/cycle/${params.id}`);
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

// Inline marker for any control that sends an email when committed.
// Hover the icon to see exactly who receives mail.
function EmailMarker({ recipients, label = 'Sends email' }: { recipients: string; label?: string }) {
  return (
    <span
      title={`${label} — ${recipients}`}
      aria-label={`${label}: ${recipients}`}
      className="inline-flex items-center justify-center align-middle text-blue-600/80 ml-1"
    >
      <Mail className="w-3.5 h-3.5" />
    </span>
  )
}

// ─── Coverage Heatmap ────────────────────────────────────────────────────────

type CoverageData = {
  configured: boolean
  slots: { startTime: string; endTime: string; freeInterviewerCount: number; bookedInterviewCount: number }[]
  slotDurationMinutes: number
  timezone: string
  totalInterviewers?: number
}

function CoverageHeatmap({ coverage }: { coverage: CoverageData | null }) {
  if (!coverage) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-sm p-6 text-sm text-muted-foreground">
        Loading availability coverage…
      </div>
    )
  }
  if (!coverage.configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        Set an interview window and slot length in <span className="font-semibold">Interview Config</span> to see availability coverage.
      </div>
    )
  }
  if (coverage.slots.length === 0) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-4 text-sm text-muted-foreground">
        No future slots fall inside the configured interview window.
      </div>
    )
  }

  const tz = coverage.timezone
  // Group slots by local date (YYYY-MM-DD in cycle timezone).
  const byDay = new Map<string, typeof coverage.slots>()
  const timeKeys = new Set<string>()
  for (const slot of coverage.slots) {
    const d = new Date(slot.startTime)
    const dayKey = d.toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
    const timeKey = d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    timeKeys.add(timeKey)
    if (!byDay.has(dayKey)) byDay.set(dayKey, [])
    byDay.get(dayKey)!.push(slot)
  }
  const days = Array.from(byDay.keys()).sort()
  const times = Array.from(timeKeys).sort()

  // Lookup: (dayKey, timeKey) -> slot
  const lookup = new Map<string, typeof coverage.slots[number]>()
  for (const slot of coverage.slots) {
    const d = new Date(slot.startTime)
    const dayKey = d.toLocaleDateString('en-CA', { timeZone: tz })
    const timeKey = d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    lookup.set(`${dayKey}|${timeKey}`, slot)
  }

  // Totals
  const totalFreeHours = coverage.slots.reduce((sum, s) => sum + (s.freeInterviewerCount * coverage.slotDurationMinutes) / 60, 0)
  const totalBooked = coverage.slots.reduce((sum, s) => sum + s.bookedInterviewCount, 0)
  const slotHours = coverage.slotDurationMinutes / 60

  function cellColor(freeCount: number) {
    if (freeCount === 0) return 'bg-muted/40 text-muted-foreground/60'
    if (freeCount <= 2) return 'bg-amber-100 text-amber-900'
    if (freeCount <= 4) return 'bg-emerald-100 text-emerald-900'
    if (freeCount <= 6) return 'bg-emerald-200 text-emerald-900'
    return 'bg-emerald-300 text-emerald-950'
  }

  function formatTime(timeKey: string) {
    const [hh, mm] = timeKey.split(':').map(Number)
    const period = hh >= 12 ? 'p' : 'a'
    const h12 = hh % 12 === 0 ? 12 : hh % 12
    return mm === 0 ? `${h12}${period}` : `${h12}:${String(mm).padStart(2, '0')}${period}`
  }

  function formatDay(dayKey: string) {
    // dayKey is YYYY-MM-DD; parse as UTC noon to avoid TZ drift then format.
    const d = new Date(`${dayKey}T12:00:00Z`)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: tz })
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h3 className="text-sm font-bold text-foreground/80">Lab-wide availability coverage</h3>
        <div className="text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{totalFreeHours.toFixed(0)}</span> interviewer-hours offered ·{' '}
          <span className="font-semibold text-foreground">{totalBooked}</span> interview{totalBooked === 1 ? '' : 's'} booked ·{' '}
          <span className="font-semibold text-foreground">{coverage.totalInterviewers ?? 0}</span> interviewer{coverage.totalInterviewers === 1 ? '' : 's'} ·{' '}
          {slotHours < 1 ? `${coverage.slotDurationMinutes} min` : `${slotHours} h`} slots
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0.5">
          <thead>
            <tr>
              <th className="text-left px-2 py-1 text-muted-foreground font-medium sticky left-0 bg-card z-10">Time</th>
              {days.map((day) => (
                <th key={day} className="px-2 py-1 text-center font-semibold text-foreground/80 whitespace-nowrap">
                  {formatDay(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time}>
                <td className="px-2 py-1 text-right text-muted-foreground font-medium sticky left-0 bg-card whitespace-nowrap">
                  {formatTime(time)}
                </td>
                {days.map((day) => {
                  const slot = lookup.get(`${day}|${time}`)
                  if (!slot) {
                    return <td key={`${day}-${time}`} className="px-2 py-1 bg-transparent" />
                  }
                  const free = slot.freeInterviewerCount
                  const booked = slot.bookedInterviewCount
                  return (
                    <td
                      key={`${day}-${time}`}
                      title={`${free} interviewer${free === 1 ? '' : 's'} free${booked > 0 ? ` · ${booked} booked` : ''}`}
                      className={`px-2 py-1 text-center font-semibold rounded ${cellColor(free)} relative min-w-[44px]`}
                    >
                      {free}
                      {booked > 0 && (
                        <span className="absolute top-0.5 right-0.5 flex gap-0.5">
                          {Array.from({ length: Math.min(booked, 3) }).map((_, i) => (
                            <span key={i} className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                          ))}
                          {booked > 3 && <span className="text-[9px] text-blue-700 font-bold leading-none">+</span>}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-muted/40 border border-border" />0
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-amber-100" />1–2 thin
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-100" />3–4
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-200" />5–6
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-emerald-300" />7+
        </span>
        <span className="inline-flex items-center gap-1.5 ml-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />booked
        </span>
      </div>
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function HiringLeadCycleDetails() {
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
    rescheduleNoticeHours: 12,
    cancelNoticeHours: 0,
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
  const [expandedInterviewers, setExpandedInterviewers] = useState<Set<string>>(new Set())

  // ── Interviews state ──
  const [interviews, setInterviews] = useState<InterviewRow[]>([])

  // ── Coverage heatmap state ──
  const [coverage, setCoverage] = useState<{
    configured: boolean
    slots: { startTime: string; endTime: string; freeInterviewerCount: number; bookedInterviewCount: number }[]
    slotDurationMinutes: number
    timezone: string
    totalInterviewers?: number
  } | null>(null)

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
      const r = await fetch(`/api/hiring/cycles/${cycleId}/status`, { credentials: 'include' })
      if (!r.ok) return
      const data = await r.json()
      if (data) setCycleStatus(data.currentStatus)
    } catch {}
  }, [cycleId])

  const loadConfig = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interview-config`, { credentials: 'include' })
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
      const r = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, { credentials: 'include' })
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
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, { credentials: 'include' })
      setInterviewers(r.ok ? await r.json() : [])
    } catch {}
  }, [cycleId])

  const loadInterviews = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interviews`, { credentials: 'include' })
      setInterviews(r.ok ? await r.json() : [])
    } catch {}
  }, [cycleId])

  const loadCoverage = useCallback(async () => {
    if (!cycleId) return
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/coverage`, { credentials: 'include' })
      setCoverage(r.ok ? await r.json() : null)
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
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
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
    loadCoverage()
  }, [cycleId, loadStatus, loadConfig, loadReviewers, loadMembers, loadDomains, loadInterviewers, loadInterviews, loadCoverage])

  // ── Handlers ──

  async function saveConfig() {
    if (!cycleId) return
    setConfigSaving(true)
    try {
      // Anchor the date inputs at midnight in the cycle's timezone — my-availability and slot generation expect this.
      const toZonedMidnightIso = (ymd: string): string => {
        const [y, m, d] = ymd.split('-').map(Number)
        return zonedDayStartUtc(y, m, d, config.timezone).toISOString()
      }
      const payload = {
        ...config,
        interviewStartDate: config.interviewStartDate
          ? toZonedMidnightIso(config.interviewStartDate)
          : config.interviewStartDate,
        interviewEndDate: config.interviewEndDate
          ? toZonedMidnightIso(config.interviewEndDate)
          : config.interviewEndDate,
      }
      const res = await fetch(`/api/hiring/cycles/${cycleId}/interview-config`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: newMemberId, domainId: newDomainId }),
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
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setReviewers(prev => prev.filter(r => r.id !== reviewerId))
    }
  }

  async function addInterviewer() {
    if (!cycleId || !newInterviewerMemberId || !newInterviewerDomainId) return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: newInterviewerMemberId, domainId: newInterviewerDomainId }),
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
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
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

      <CloseDateNotice />

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
            const allDomainsReady = domains.length > 0 && domains.every((d: any) => d.isReady);
            return hasCloseDate && domains.length > 0 && domains.every((d: any) => coveredDomainIds.has(d.domainId)) && hasGeneralForm && allDomainsReady;
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
        const allDomainsReady = domains.length > 0 && domains.every((d: any) => d.isReady);
        const hasGeneralRubric = !!cycle?.generalRubricVersionId;
        const ready = hasCloseDate && allDomainsCovered && hasGeneralForm && allDomainsReady;
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
                {allDomainsReady
                  ? <CheckCircle className="w-4 h-4 text-green-600" />
                  : <Circle className="w-4 h-4 text-muted-foreground/70" />}
                <span className={allDomainsReady ? 'text-green-800' : 'text-muted-foreground'}>
                  Every domain is marked ready
                  {domains.length === 0 && ' (no domains added)'}
                </span>
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
          {/* Close Date + Extension + Effective Close */}
          <CloseDateCard
            cycle={cycle}
            cycleStatus={cycleStatus}
          />


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
              <Form method="post" preventScrollReset className="flex items-end gap-3 pt-2 border-t border-border">
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

          {/* Confidentiality Agreement */}
          <ConfidentialityAgreementPicker
            currentBinding={loaderData?.currentConfidentialityBinding ?? null}
            agreementOptions={loaderData?.confidentialityAgreementOptions ?? []}
            signatures={loaderData?.confidentialitySignatures ?? []}
          />

          {/* Decision-release email bindings */}
          <DecisionEmailsSection
            emailTemplates={loaderData?.emailTemplates ?? []}
            currentDecisionEmails={loaderData?.currentDecisionEmails ?? []}
            releasedDecisionTypes={loaderData?.releasedDecisionTypes ?? []}
          />

          {/* Non-decision notification email bindings */}
          <NotificationEmailsSection
            emailTemplates={loaderData?.emailTemplates ?? []}
            currentNotificationEmails={loaderData?.currentNotificationEmails ?? []}
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
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Reschedule Notice</label>
              <select
                value={config.rescheduleNoticeHours}
                onChange={e => setConfig(c => ({ ...c, rescheduleNoticeHours: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {[0, 2, 4, 6, 8, 12, 24, 48].map(h => <option key={h} value={h}>{h === 0 ? 'No minimum' : `${h} hours before`}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-foreground/80 mb-1">Cancel Notice</label>
              <select
                value={config.cancelNoticeHours}
                onChange={e => setConfig(c => ({ ...c, cancelNoticeHours: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                {[0, 2, 4, 6, 8, 12, 24, 48].map(h => <option key={h} value={h}>{h === 0 ? 'Up until start' : `${h} hours before`}</option>)}
              </select>
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
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Reviewer</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {reviewers.map(r => {
                  const m = r.user
                  const name = m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? r.user.id
                  return (
                  <tr key={r.id} className="hover:bg-muted/50 transition">
                    <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.domain.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeReviewer(r.id)} className="text-red-500 hover:text-red-700 transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  )
                })}
                {reviewers.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/70"><span className="sr-only">Table empty: </span>No reviewers assigned yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
            <ul className="sm:hidden divide-y divide-border">
              {reviewers.map(r => {
                const m = r.user
                const name = m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? r.user.id
                return (
                <li key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{r.domain.name}</div>
                  </div>
                  <button
                    onClick={() => removeReviewer(r.id)}
                    aria-label="Remove reviewer"
                    className="p-2 -m-2 text-red-500 hover:text-red-700 transition flex-shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
                )
              })}
              {reviewers.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground/70">No reviewers assigned yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── Interviewers Roster (shown under Interview Setup) ── */}
      {tab === 'config' && (
        <div className="space-y-4 mt-4">
          <h3 className="text-base font-bold text-foreground/90 flex items-center gap-2">
            <Users className="w-4 h-4" /> Interviewers
          </h3>
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
          {interviewers.length > 0 && (() => {
            const submitted = interviewers.filter((i: any) => (i.availabilityBlockCount ?? 0) > 0).length
            const total = interviewers.length
            const allSubmitted = submitted === total
            return (
              <div className={`rounded-lg px-4 py-3 text-sm border ${
                allSubmitted
                  ? 'bg-green-50 border-green-200 text-green-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <span className="font-semibold">{submitted} of {total}</span> interviewer{total === 1 ? '' : 's'} ha{submitted === 1 ? 's' : 've'} submitted availability
                {!allSubmitted && total - submitted > 0 && (
                  <span className="text-amber-800/80"> · {total - submitted} pending</span>
                )}
              </div>
            )
          })()}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Interviewer</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Availability</th>
                  <th className="text-right px-4 py-3 font-bold text-foreground/80">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {interviewers.map((i: any) => {
                  const m = i.user
                  const name = m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? i.userId
                  const hours = i.availabilityHours ?? 0
                  const blocks = i.availabilityBlockCount ?? 0
                  const hasAvail = blocks > 0
                  const isExpanded = expandedInterviewers.has(i.id)
                  const toggle = () => setExpandedInterviewers(prev => {
                    const next = new Set(prev)
                    if (next.has(i.id)) next.delete(i.id); else next.add(i.id)
                    return next
                  })
                  return (
                    <Fragment key={i.id}>
                      <tr className="hover:bg-muted/50 transition">
                        <td className="px-4 py-3 font-medium text-foreground">
                          {hasAvail ? (
                            <button onClick={toggle} className="inline-flex items-center gap-1.5 text-left hover:underline">
                              <span className={`text-muted-foreground transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
                              {name}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-2" />
                              {name}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{i.domain?.name ?? ''}</td>
                        <td className="px-4 py-3">
                          {hasAvail ? (
                            <span className="inline-flex items-center gap-1.5 text-green-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              {hours.toFixed(1)}h <span className="text-muted-foreground">({blocks} block{blocks === 1 ? '' : 's'})</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-amber-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              Not submitted
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => removeInterviewer(i.id)} className="text-red-500 hover:text-red-700 transition">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && hasAvail && (
                        <tr className="bg-muted/20">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-xs">
                              {(i.availabilityBlocks ?? []).map((b: any, idx: number) => {
                                const start = new Date(b.startTime)
                                const end = new Date(b.endTime)
                                const sameDay = start.toDateString() === end.toDateString()
                                const dur = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
                                return (
                                  <div key={idx} className="flex items-baseline gap-2">
                                    <span className="font-medium text-foreground whitespace-nowrap">
                                      {start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                                      {' – '}
                                      {sameDay
                                        ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                                        : `${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                                    </span>
                                    <span className="text-muted-foreground/60">({dur.toFixed(1)}h)</span>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {interviewers.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground/70"><span className="sr-only">Table empty: </span>No interviewers assigned yet.</td></tr>
                )}
              </tbody>
            </table>
            </div>
            <ul className="sm:hidden divide-y divide-border">
              {interviewers.map((i: any) => {
                const m = i.user
                const name = m?.firstName && m?.lastName ? `${m.firstName} ${m.lastName}` : m?.daliEmail ?? i.userId
                const hours = i.availabilityHours ?? 0
                const blocks = i.availabilityBlockCount ?? 0
                const hasAvail = blocks > 0
                const isExpanded = expandedInterviewers.has(i.id)
                const toggle = () => setExpandedInterviewers(prev => {
                  const next = new Set(prev)
                  if (next.has(i.id)) next.delete(i.id); else next.add(i.id)
                  return next
                })
                return (
                  <li key={i.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={hasAvail ? toggle : undefined}
                        className="min-w-0 text-left flex-1"
                        disabled={!hasAvail}
                      >
                        <div className="font-medium text-foreground truncate flex items-center gap-1.5">
                          {hasAvail && <span className={`text-muted-foreground transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>▸</span>}
                          {name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{i.domain?.name ?? ''}</div>
                        <div className="text-xs mt-1">
                          {hasAvail ? (
                            <span className="inline-flex items-center gap-1.5 text-green-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              {hours.toFixed(1)}h · {blocks} block{blocks === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-amber-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              No availability yet
                            </span>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={() => removeInterviewer(i.id)}
                        aria-label="Remove interviewer"
                        className="p-2 -m-2 text-red-500 hover:text-red-700 transition flex-shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    {isExpanded && hasAvail && (
                      <div className="mt-2 pl-4 space-y-1 text-xs">
                        {(i.availabilityBlocks ?? []).map((b: any, idx: number) => {
                          const start = new Date(b.startTime)
                          const end = new Date(b.endTime)
                          const sameDay = start.toDateString() === end.toDateString()
                          return (
                            <div key={idx} className="text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                              </span>{' '}
                              {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – {sameDay
                                ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                                : `${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </li>
                )
              })}
              {interviewers.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground/70">No interviewers assigned yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── Interview Dashboard Tab ── */}
      {tab === 'dashboard' && loaderData?.confidentialityRequired ? (
        <ConfidentialityGate
          cycleId={cycleId ?? ''}
          reason={loaderData.confidentialityRequired}
          next={`/hiring/lead/cycle/${cycleId}?tab=dashboard`}
        />
      ) : tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900 inline-flex items-center gap-2">
            <Mail className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
            <span>Controls marked with <Mail className="w-3 h-3 inline-block align-middle text-blue-600" /> send an email when committed. Hover the icon to see who receives it.</span>
          </div>
          <CoverageHeatmap coverage={coverage} />
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Applicant</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Domain</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Time</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Status</th>
                  <th className="text-left px-4 py-3 font-bold text-foreground/80">Location</th>
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
                      <td className="px-4 py-3">
                        {isFuture && interview.status === 'Scheduled' ? (
                          <span className="inline-flex items-center gap-1">
                            <select
                              value={interview.location}
                              onChange={async (e) => {
                                const newLocation = e.target.value
                                const res = await fetch(`/api/hiring/interviews/${interview.id}/location`, {
                                  method: 'PATCH',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ location: newLocation }),
                                })
                                if (res.ok) {
                                  const updated = await res.json()
                                  setInterviews(prev => prev.map(i =>
                                    i.id === interview.id ? { ...i, location: newLocation, zoomJoinUrl: updated.zoomJoinUrl ?? null } : i
                                  ))
                                } else {
                                  const body = await res.json().catch(() => ({}))
                                  alert(body.error ?? 'Failed to update location')
                                }
                              }}
                              className="text-xs border border-border rounded px-1.5 py-0.5 bg-card"
                            >
                              <option value="PodAppa">Pod Appa</option>
                              <option value="PodMomo">Pod Momo</option>
                              <option value="Online">Online</option>
                            </select>
                            <EmailMarker recipients="applicant + both interviewers" label="Changing fires location-change email" />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {interview.location === 'PodAppa' ? 'Pod Appa' :
                             interview.location === 'PodMomo' ? 'Pod Momo' : 'Online'}
                          </span>
                        )}
                        {interview.location === 'Online' && isFuture && interview.status === 'Scheduled' && (
                          <input
                            type="url"
                            placeholder="Paste meeting link (emails on save)"
                            title="Sends location-change email to applicant + both interviewers when you tab away"
                            defaultValue={interview.zoomJoinUrl ?? ''}
                            onBlur={async (e) => {
                              let meetingUrl = e.target.value.trim()
                              if (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) {
                                meetingUrl = `https://${meetingUrl}`
                                e.target.value = meetingUrl
                              }
                              if (meetingUrl === (interview.zoomJoinUrl ?? '')) return
                              const res = await fetch(`/api/hiring/interviews/${interview.id}/location`, {
                                method: 'PATCH',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ location: 'Online', meetingUrl }),
                              })
                              if (res.ok) {
                                setInterviews(prev => prev.map(i =>
                                  i.id === interview.id ? { ...i, zoomJoinUrl: meetingUrl || null } : i
                                ))
                              }
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="block w-full text-xs border border-border rounded px-1.5 py-0.5 bg-card mt-1 placeholder:text-muted-foreground/50"
                          />
                        )}
                        {interview.location === 'Online' && interview.zoomJoinUrl && !(isFuture && interview.status === 'Scheduled') && (
                          <a href={interview.zoomJoinUrl} target="_blank" rel="noopener noreferrer"
                             className="block text-xs text-blue-600 hover:underline mt-0.5">Meeting link</a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {interview.assignments
                          .filter((a: any) => a.status === 'Active')
                          .map((a: any) => {
                            const m = a.cycleInterviewer.user
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
                                      await fetch(`/api/hiring/interviews/${interview.id}/reassign`, {
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
                                        const im = i.user
                                        const iName = im?.firstName && im?.lastName ? `${im.firstName} ${im.lastName}` : im?.daliEmail ?? i.id
                                        return <option key={i.id} value={i.id}>{iName}</option>
                                      })}
                                  </select>
                                )}
                                {isFuture && interview.status === 'Scheduled' && (
                                  <EmailMarker recipients="removed + replacement interviewer" label="Reassigning fires emails" />
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
            <ul className="sm:hidden divide-y divide-border">
              {interviews.map(interview => {
                const isFuture = new Date(interview.startTime) > new Date()
                const domainName = interview.domainApplication.challengeVersion.domain.name
                const start = new Date(interview.startTime)
                const end = new Date(interview.endTime)
                const editable = isFuture && interview.status === 'Scheduled'
                return (
                  <li key={interview.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {interview.domainApplication.application.user.firstName} {interview.domainApplication.application.user.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{domainName || '—'}</div>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 ${
                        interview.status === 'Scheduled' ? 'bg-green-100 text-green-700' :
                        interview.status === 'Completed' ? 'bg-blue-100 text-blue-700' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {interview.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                      {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                      {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Location</div>
                      {editable ? (
                        <select
                          value={interview.location}
                          onChange={async (e) => {
                            const newLocation = e.target.value
                            const res = await fetch(`/api/hiring/interviews/${interview.id}/location`, {
                              method: 'PATCH', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ location: newLocation }),
                            })
                            if (res.ok) {
                              const updated = await res.json()
                              setInterviews(prev => prev.map(i =>
                                i.id === interview.id ? { ...i, location: newLocation, zoomJoinUrl: updated.zoomJoinUrl ?? null } : i
                              ))
                            } else {
                              const body = await res.json().catch(() => ({}))
                              alert(body.error ?? 'Failed to update location')
                            }
                          }}
                          className="w-full text-xs border border-border rounded px-1.5 py-1 bg-card"
                        >
                          <option value="PodAppa">Pod Appa</option>
                          <option value="PodMomo">Pod Momo</option>
                          <option value="Online">Online</option>
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {interview.location === 'PodAppa' ? 'Pod Appa' :
                           interview.location === 'PodMomo' ? 'Pod Momo' : 'Online'}
                        </span>
                      )}
                      {interview.location === 'Online' && editable && (
                        <input
                          type="url"
                          placeholder="Paste meeting link"
                          defaultValue={interview.zoomJoinUrl ?? ''}
                          onBlur={async (e) => {
                            let meetingUrl = e.target.value.trim()
                            if (meetingUrl && !/^https?:\/\//i.test(meetingUrl)) {
                              meetingUrl = `https://${meetingUrl}`
                              e.target.value = meetingUrl
                            }
                            if (meetingUrl === (interview.zoomJoinUrl ?? '')) return
                            const res = await fetch(`/api/hiring/interviews/${interview.id}/location`, {
                              method: 'PATCH', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ location: 'Online', meetingUrl }),
                            })
                            if (res.ok) {
                              setInterviews(prev => prev.map(i =>
                                i.id === interview.id ? { ...i, zoomJoinUrl: meetingUrl || null } : i
                              ))
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          className="block w-full text-xs border border-border rounded px-1.5 py-1 bg-card mt-1 placeholder:text-muted-foreground/50"
                        />
                      )}
                      {interview.location === 'Online' && interview.zoomJoinUrl && !editable && (
                        <a href={interview.zoomJoinUrl} target="_blank" rel="noopener noreferrer"
                           className="block text-xs text-blue-600 hover:underline mt-0.5">Meeting link</a>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Interviewers</div>
                      <div className="space-y-1">
                        {interview.assignments
                          .filter((a: any) => a.status === 'Active')
                          .map((a: any) => {
                            const m = a.cycleInterviewer.user
                            const name = m.firstName && m.lastName
                              ? `${m.firstName} ${m.lastName}`
                              : m.daliEmail ?? '?'
                            const roleLabel = a.role === 'InDomain' ? a.cycleInterviewer.domain.name : 'Cross'
                            return (
                              <div key={a.id} className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                                <span>{name} ({roleLabel})</span>
                                {editable && (
                                  <select
                                    className="text-xs border border-gray-300 rounded px-1.5 py-0.5"
                                    aria-label={`Reassign ${a.role === 'InDomain' ? 'in-domain' : 'cross-domain'} interviewer`}
                                    defaultValue=""
                                    onChange={async (e) => {
                                      if (!e.target.value) return
                                      await fetch(`/api/hiring/interviews/${interview.id}/reassign`, {
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
                                        const im = i.user
                                        const iName = im?.firstName && im?.lastName ? `${im.firstName} ${im.lastName}` : im?.daliEmail ?? i.id
                                        return <option key={i.id} value={i.id}>{iName}</option>
                                      })}
                                  </select>
                                )}
                                {editable && (
                                  <EmailMarker recipients="removed + replacement interviewer" label="Reassigning fires emails" />
                                )}
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  </li>
                )
              })}
              {interviews.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground/70">No interviews scheduled yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ── Decisions Tab ── */}
      {tab === 'decisions' && loaderData?.confidentialityRequired ? (
        <ConfidentialityGate
          cycleId={cycleId ?? ''}
          reason={loaderData.confidentialityRequired}
          next={`/hiring/lead/cycle/${cycleId}?tab=decisions`}
        />
      ) : tab === 'decisions' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900 inline-flex items-center gap-2">
            <Mail className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
            <span><span className="font-semibold">Release</span> emails the applicant the decision (using the bound template). It cannot be undone.</span>
          </div>
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
                        await fetch(`/api/hiring/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
                      }
                      setPendingDecisions(prev => prev.filter(p => !boundTypes.has(p.type)))
                    }}
                    disabled={releasable.length === 0}
                    title={
                      skipped > 0
                        ? `${skipped} decision${skipped === 1 ? '' : 's'} skipped — no email template bound on the Setup tab`
                        : undefined
                    }
                    className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition self-start sm:self-auto disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                  >
                    <Mail className="w-3.5 h-3.5" aria-hidden />
                    Release All ({releasable.length})
                    {skipped > 0 && ` — ${skipped} skipped, no template bound`}
                  </button>
                )
              })()}
            </div>
            <div className="hidden sm:block overflow-x-auto">
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
                            await fetch(`/api/hiring/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
                            setPendingDecisions(prev => prev.filter(p => p.id !== d.id))
                            setReleasing(null)
                          }}
                          disabled={releasing === d.id || !hasBinding}
                          title={
                            !hasBinding
                              ? `No email template bound to ${d.type} in this cycle. Bind one on the Setup tab → Decision Emails before releasing.`
                              : undefined
                          }
                          className="px-3 py-1 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        >
                          <Mail className="w-3.5 h-3.5" aria-hidden />
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
            <ul className="sm:hidden divide-y divide-border">
              {pendingDecisions.map((d: any) => {
                const hasBinding = (loaderData?.currentDecisionEmails ?? []).some(
                  (b: any) => b.decisionType === d.type
                )
                return (
                  <li key={d.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {d.domainApplication.application.user.firstName} {d.domainApplication.application.user.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {d.domainApplication.challengeVersion.domain.name}
                        </div>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0 ${
                        d.type === 'Accepted' ? 'bg-green-100 text-green-700' :
                        d.type === 'Rejected' ? 'bg-red-100 text-red-700' :
                        d.type === 'Waitlisted' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {d.type}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Made by {d.madeBy.firstName} {d.madeBy.lastName}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewDecisionId(d.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-border bg-card hover:bg-muted/40 text-foreground transition"
                        aria-label={`Preview email for ${d.domainApplication.application.user.firstName}`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Preview
                      </button>
                      <button
                        onClick={async () => {
                          setReleasing(d.id)
                          await fetch(`/api/hiring/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
                          setPendingDecisions(prev => prev.filter(p => p.id !== d.id))
                          setReleasing(null)
                        }}
                        disabled={releasing === d.id || !hasBinding}
                        title={
                          !hasBinding
                            ? `No email template bound to ${d.type} in this cycle. Bind one on the Setup tab → Decision Emails before releasing.`
                            : undefined
                        }
                        className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                      >
                        <Mail className="w-3.5 h-3.5" aria-hidden />
                        {releasing === d.id ? 'Releasing...' : 'Release'}
                      </button>
                    </div>
                  </li>
                )
              })}
              {pendingDecisions.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-muted-foreground/70">No Final decisions awaiting release.</li>
              )}
            </ul>
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

function PreviewLintWarning({ unknown, unfilled }: { unknown: string[]; unfilled: string[] }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="w-3.5 h-3.5" />
        Template warnings
      </div>
      {unknown.length > 0 && (
        <p>
          Unknown placeholder{unknown.length > 1 ? 's' : ''}:{' '}
          {unknown.map((t, i) => (
            <span key={t}>
              {i > 0 && ', '}
              <code className="font-mono bg-amber-100 px-1 rounded">{`{{${t}}}`}</code>
            </span>
          ))}
          . Will ship as literal text.
        </p>
      )}
      {unfilled.length > 0 && (
        <p>
          Not populated for this slot:{' '}
          {unfilled.map((t, i) => (
            <span key={t}>
              {i > 0 && ', '}
              <code className="font-mono bg-amber-100 px-1 rounded">{`{{${t}}}`}</code>
            </span>
          ))}
          . Will render as empty.
        </p>
      )}
    </div>
  );
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
  const slot: TemplateSlot | undefined = decision.type ? decisionSlot(decision.type as DecisionSlotType) : undefined
  const lint = tmpl
    ? (() => {
        const subj = lintTemplate(tmpl.subject, slot)
        const body = lintTemplate(tmpl.body, slot)
        return {
          unknown: Array.from(new Set([...subj.unknown, ...body.unknown])),
          unfilled: Array.from(new Set([...subj.unfilled, ...body.unfilled])),
        }
      })()
    : null

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
              {lint && (lint.unknown.length > 0 || lint.unfilled.length > 0) && (
                <PreviewLintWarning unknown={lint.unknown} unfilled={lint.unfilled} />
              )}
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
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
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
    const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
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
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
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
              <span>
                {closeDate.toLocaleString("en-US", {
                  timeZone: APPLICATION_TZ,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                {APPLICATION_TZ_LABEL}
              </span>
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

function CloseDateNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const n = url.searchParams.get("notice");
    if (!n) return;
    setNotice(n);
    url.searchParams.delete("notice");
    window.history.replaceState({}, "", url.toString());
  }, []);
  if (!notice) return null;
  const messages: Record<string, { text: string; tone: "ok" | "warn" }> = {
    "deadline-set": { text: "Close date saved.", tone: "ok" },
    "deadline-set-reopened": {
      text: "Close date saved and applications reopened — applicants can submit again until the new deadline.",
      tone: "warn",
    },
    "deadline-cleared": { text: "Close date cleared.", tone: "ok" },
    "extended": { text: "Extension saved. Applicants will see an “Extended deadline” notice on the portal during the window.", tone: "ok" },
    "extended-reopened": {
      text: "Extension saved and applications reopened — applicants can submit again until the new effective close.",
      tone: "warn",
    },
    "extension-removed": { text: "Extension removed — the close date is back to the original.", tone: "ok" },
    "extension-notice-sent": { text: "Extension notice email sent to applicants who haven't submitted yet.", tone: "ok" },
    "extension-notice-partial": { text: "Extension notice sent — some recipients failed (see server logs).", tone: "warn" },
    "extension-notice-noop": { text: "No extension notice sent — no draft applicants in this cycle.", tone: "warn" },
    "extension-notice-all-sent": { text: "Every draft applicant has already received the extension notice — nothing to resend.", tone: "ok" },
    "extension-notice-no-extension": { text: "No extension is currently set on this cycle. Set an extension first.", tone: "warn" },
    "extension-notice-not-configured": { text: "Extension notice not sent — no template is bound to the “Deadline Extension Notice” slot, or the gmail account isn't configured.", tone: "warn" },
  };
  const m = messages[notice];
  if (!m) return null;
  const toneCls = m.tone === "warn"
    ? "bg-amber-50 border-amber-200 text-amber-900"
    : "bg-green-50 border-green-200 text-green-900";
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${toneCls}`} role="status">
      <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">{m.text}</div>
      <button
        type="button"
        onClick={() => setNotice(null)}
        className="text-xs text-foreground/60 hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function formatCloseInstant(d: Date): string {
  return `${d.toLocaleString("en-US", {
    timeZone: APPLICATION_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ${APPLICATION_TZ_LABEL}`;
}

function describeExtension(deltaMs: number): { amount: number; unit: "hours" | "days" } {
  if (deltaMs <= 0) return { amount: 48, unit: "hours" };
  // Round to nearest hour, then express in days if it's a whole-day multiple.
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours > 0 && hours % 24 === 0) return { amount: hours / 24, unit: "days" };
  return { amount: hours, unit: "hours" };
}

function CloseDateCard({ cycle, cycleStatus }: { cycle: any; cycleStatus: string }) {
  const closeDate = cycle?.closeDate ? new Date(cycle.closeDate) : null;
  const originalCloseDate = cycle?.originalCloseDate ? new Date(cycle.originalCloseDate) : null;
  const anchor = originalCloseDate ?? closeDate;
  const extensionMs = originalCloseDate && closeDate
    ? closeDate.getTime() - originalCloseDate.getTime()
    : 0;
  const extensionActive = extensionMs > 0;
  const pickerDateValue = anchor
    ? (() => {
        const { year, month, day } = getZonedYMD(anchor, APPLICATION_TZ);
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      })()
    : "";

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-6 space-y-6">
      {/* 1. Original close date */}
      <div>
        <h3 className="text-sm font-bold text-foreground/80 mb-1">Application Close Date</h3>
        <p className="text-xs text-muted-foreground mb-3">
          The intended close — applications stop at 11:59 PM {APPLICATION_TZ_LABEL} on this date. If an
          extension is set below, saving a new date moves the extension along with it.
        </p>
        <Form method="post" preventScrollReset className="flex flex-col sm:flex-row sm:items-end gap-3">
          <input type="hidden" name="intent" value="set-close-date" />
          <div className="flex-1">
            <input
              type="date"
              name="closeDate"
              defaultValue={pickerDateValue}
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

      {/* 2. Extension */}
      {closeDate && (
        <div className="border-t border-border pt-4">
          <ExtensionSection
            cycleId={cycle.id}
            anchor={anchor!}
            extensionMs={extensionMs}
            extensionActive={extensionActive}
            cycleStatus={cycleStatus}
            extensionNoticeSentAt={cycle?.extensionNoticeSentAt ? new Date(cycle.extensionNoticeSentAt) : null}
          />
        </div>
      )}

      {/* 3. Effective close (read-only) */}
      {closeDate && (
        <div className="border-t border-border pt-4">
          <h4 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-1">Effective Close</h4>
          <p className="text-base font-semibold text-foreground">
            {formatCloseInstant(closeDate)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            When applications actually stop. Auto-closes the cycle (Open → Under Review) at this moment.
            {extensionActive && originalCloseDate && (
              <> Applicants see a &ldquo;Deadline extended&rdquo; notice between {formatCloseInstant(originalCloseDate)} and this time.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function ExtensionSection({
  cycleId,
  anchor,
  extensionMs,
  extensionActive,
  cycleStatus,
  extensionNoticeSentAt,
}: {
  cycleId: string;
  anchor: Date;
  extensionMs: number;
  extensionActive: boolean;
  cycleStatus: string;
  extensionNoticeSentAt: Date | null;
}) {
  const initial = describeExtension(extensionMs);
  const [amount, setAmount] = useState<number>(initial.amount);
  const [unit, setUnit] = useState<"hours" | "days">(initial.unit);
  const [showConfirm, setShowConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const removeFormRef = useRef<HTMLFormElement>(null);
  const headingId = `extend-confirm-heading-${cycleId}`;

  const ms = unit === "hours" ? amount * 3_600_000 : amount * 86_400_000;
  const nextClose = new Date(anchor.getTime() + ms);
  const willReopen = cycleStatus === "UnderReview" && nextClose.getTime() > Date.now();
  const stillInPast = nextClose.getTime() <= Date.now();

  return (
    <>
      <h4 className="text-xs font-semibold text-foreground/70 uppercase tracking-wide mb-1">
        Extension {extensionActive ? "(active)" : "(optional)"}
      </h4>
      <p className="text-xs text-muted-foreground mb-3">
        Adds time after the close date. Applicants see a &ldquo;Deadline extended&rdquo; notice during the
        extension window.
      </p>
      <Form
        method="post"
        preventScrollReset
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          setShowConfirm(true);
        }}
        className="space-y-2"
        aria-label={`Set deadline extension for cycle ${cycleId}`}
      >
        <input type="hidden" name="intent" value="extend-close-date" />
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="flex items-end gap-2 flex-1">
            <div className="w-24">
              <label className="block text-xs text-muted-foreground mb-1" htmlFor={`extend-amount-${cycleId}`}>Amount</label>
              <input
                id={`extend-amount-${cycleId}`}
                type="number"
                name="amount"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1" htmlFor={`extend-unit-${cycleId}`}>Unit</label>
              <select
                id={`extend-unit-${cycleId}`}
                name="unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as "hours" | "days")}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={!Number.isFinite(amount) || amount <= 0}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white transition"
          >
            {extensionActive ? "Update extension" : "Set extension"}
          </button>
        </div>
      </Form>
      {extensionActive && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Form
            method="post"
            preventScrollReset
            aria-label="Resend deadline-extension email to draft applicants"
          >
            <input type="hidden" name="intent" value="resend-extension-notice" />
            <button
              type="submit"
              className="text-xs font-medium text-blue-700 hover:text-blue-900 underline"
            >
              {extensionNoticeSentAt ? "Resend extension notice" : "Send extension notice now"}
            </button>
          </Form>
          {extensionNoticeSentAt && (
            <span className="text-xs text-muted-foreground">
              Last sent {formatCloseInstant(extensionNoticeSentAt)}
            </span>
          )}
          <Form
            method="post"
            preventScrollReset
            ref={removeFormRef}
            aria-label="Remove deadline extension"
          >
            <input type="hidden" name="intent" value="remove-extension" />
            <button
              type="submit"
              className="text-xs text-red-700 hover:text-red-900 underline"
            >
              Remove extension
            </button>
          </Form>
        </div>
      )}
      {showConfirm && (
        <Modal
          open
          onClose={() => setShowConfirm(false)}
          labelledBy={headingId}
          containerClassName="bg-card rounded-2xl shadow-xl max-w-md w-full mx-4 p-6"
        >
          <div className="space-y-4">
            <h2 id={headingId} className="text-lg font-bold text-foreground">
              {extensionActive ? "Update" : "Set"} extension to {amount} {unit}?
            </h2>
            <div className="text-sm text-muted-foreground space-y-3">
              <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
                <div>
                  <span className="font-medium text-foreground/80">Original close: </span>
                  <span>{formatCloseInstant(anchor)}</span>
                </div>
                <div>
                  <span className="font-medium text-foreground/80">New effective close: </span>
                  <span className="font-semibold text-foreground">{formatCloseInstant(nextClose)}</span>
                </div>
              </div>
              {willReopen && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                  This cycle is currently <span className="font-semibold">closed</span> (Under Review). Confirming
                  will <span className="font-semibold">reopen applications</span> to applicants until the new
                  close time.
                </div>
              )}
              {stillInPast && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-900">
                  The new effective close is still in the past — applications will stay closed.
                </div>
              )}
              <p>
                Applicants will see a &ldquo;Deadline extended&rdquo; notice on the portal between the original
                close and the new effective close.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  formRef.current?.submit();
                }}
                className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
              >
                Confirm
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
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
        <Form method="post" preventScrollReset className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
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
                      <Form method="post" preventScrollReset>
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
            <Form method="post" preventScrollReset className="flex items-end gap-2">
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
            <Form method="post" preventScrollReset className="flex items-end gap-2">
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
        <Form method="post" preventScrollReset className="flex justify-end gap-2 pt-2">
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
        <Form method="post" preventScrollReset className="flex justify-end gap-2 pt-2">
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
        <Form method="post" preventScrollReset className="flex items-end gap-3" onSubmit={() => setEditing(false)}>
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

const DECISION_EMAIL_SLOTS: ReadonlyArray<{ type: DecisionSlotType; label: string; description: string }> = [
  { type: "Rejected", label: "Rejected", description: "Sent when a Rejected decision is released to the applicant." },
  { type: "InvitedToInterview", label: "Invited to Interview", description: "Sent when an applicant is invited to interview." },
  { type: "Waitlisted", label: "Waitlisted", description: "Sent when an applicant is placed on the waitlist." },
  { type: "Accepted", label: "Accepted", description: "Sent when an applicant is offered a spot." },
];

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

function SlotVariableHint({ slot }: { slot: TemplateSlot }) {
  const vars = TEMPLATE_VARIABLES[slot];
  return (
    <p className="text-xs text-muted-foreground/80">
      Supports{' '}
      {vars.map((v, i) => (
        <span key={v}>
          {i > 0 && ', '}
          <code className="font-mono bg-muted px-1 rounded">{`{{${v}}}`}</code>
        </span>
      ))}
      .
    </p>
  );
}

function DecisionEmailPicker({ slot, binding, emailTemplates, locked }: {
  slot: { type: DecisionSlotType; label: string; description: string };
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
          <SlotVariableHint slot={decisionSlot(slot.type)} />
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
        <Form method="post" preventScrollReset className="flex items-end gap-2 flex-wrap" onSubmit={() => setEditing(false)}>
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

const NOTIFICATION_EMAIL_SLOTS: ReadonlyArray<{ type: NotificationSlotType; label: string; description: string }> = [
  { type: "ApplicationReceived", label: "Application Received", description: "Sent to the applicant when they first submit their application." },
  { type: "ApplicationExtensionNotice", label: "Deadline Extension Notice", description: "Sent once to applicants with a draft (unsubmitted) application after the original close passes, when an extension is in effect." },
  { type: "InterviewInviteMentor", label: "Interview Invite (Interviewer)", description: "Sent to the assigned interviewer when an interview is booked or they are reassigned." },
  { type: "InterviewConfirmedApplicant", label: "Interview Confirmed (Applicant)", description: "Sent to the applicant when their interview is booked." },
  { type: "InterviewCancelledApplicant", label: "Interview Cancelled (Applicant)", description: "Sent to the applicant when their interview is cancelled." },
  { type: "InterviewCancelledInterviewer", label: "Interview Cancelled (Interviewer)", description: "Sent to the interviewer when an interview is cancelled or they are unassigned." },
  { type: "InterviewLocationChanged", label: "Interview Location Changed", description: "Sent to both the applicant and interviewer(s) when the interview location is updated." },
];

function NotificationEmailsSection({ emailTemplates, currentNotificationEmails }: {
  emailTemplates: any[];
  currentNotificationEmails: any[];
}) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-foreground/80">Notification Emails</h3>
        <p className="text-xs text-muted-foreground">
          Pick which template fires for each notification slot. Slots without a binding will not send an email.
        </p>
      </div>
      <div className="space-y-3">
        {NOTIFICATION_EMAIL_SLOTS.map((slot) => {
          const binding = currentNotificationEmails.find((b: any) => b.notificationType === slot.type);
          return (
            <NotificationEmailPicker
              key={slot.type}
              slot={slot}
              binding={binding ?? null}
              emailTemplates={emailTemplates}
            />
          );
        })}
      </div>
    </div>
  );
}

function NotificationEmailPicker({ slot, binding, emailTemplates }: {
  slot: { type: NotificationSlotType; label: string; description: string };
  binding: any | null;
  emailTemplates: any[];
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
          <SlotVariableHint slot={notificationSlot(slot.type)} />
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium shrink-0"
          >
            {currentLabel ? "Change" : "Assign"}
          </button>
        )}
      </div>

      {!editing ? (
        currentLabel ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentLabel}</span>
          </div>
        ) : (
          <div className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
            No template assigned — this notification will not send an email.
          </div>
        )
      ) : (
        <Form method="post" preventScrollReset className="flex items-end gap-2 flex-wrap" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="set-notification-email" />
          <input type="hidden" name="notificationType" value={slot.type} />
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

function ConfidentialityAgreementPicker({
  currentBinding,
  agreementOptions,
  signatures,
}: {
  currentBinding: any | null;
  agreementOptions: any[];
  signatures: { user: { firstName: string | null; lastName: string | null } }[];
}) {
  const [editing, setEditing] = useState(!currentBinding);
  const [signersOpen, setSignersOpen] = useState(false);
  const currentName =
    currentBinding?.confidentialityAgreementVersion?.agreement?.name ?? null;
  const currentVersion =
    currentBinding?.confidentialityAgreementVersion?.versionNumber ?? null;
  const signatureCount = signatures.length;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">
        Confidentiality Agreement
      </h3>
      <p className="text-xs text-muted-foreground">
        Reviewers, interviewers, domain leads, and admins must sign this
        agreement before viewing sensitive data for the cycle. If unset, nobody
        — including you — can see submitted applications, reviews, interviews,
        notes, or decisions.
      </p>
      {!currentBinding && !editing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No agreement bound — sensitive cycle data is hidden from everyone.
        </div>
      )}
      {currentBinding && !editing ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span>
                {currentName ?? "Set"} — v{currentVersion}
              </span>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              Change
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSignersOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={`w-3 h-3 transition-transform ${signersOpen ? "rotate-90" : ""}`}
            />
            {signatureCount} signature{signatureCount === 1 ? "" : "s"}
          </button>
          {signersOpen && (
            <ul className="ml-4 space-y-1">
              {signatures.length === 0 ? (
                <li className="text-xs text-muted-foreground italic">
                  No one has signed yet.
                </li>
              ) : (
                signatures.map((sig, i) => {
                  const name =
                    `${sig.user.firstName ?? ""} ${sig.user.lastName ?? ""}`.trim() ||
                    "Unknown";
                  return (
                    <li key={i} className="text-xs text-foreground/80">
                      {name}
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      ) : (
        <Form
          method="post"
          className="flex items-end gap-3"
          onSubmit={() => setEditing(false)}
        >
          <input
            type="hidden"
            name="intent"
            value="set-confidentiality-agreement"
          />
          <div className="flex-1">
            <select
              name="confidentialityAgreementVersionId"
              defaultValue={
                currentBinding?.confidentialityAgreementVersionId ?? ""
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No agreement bound</option>
              {agreementOptions.map((a: any) =>
                (a.versions ?? []).map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {a.name} — v{v.versionNumber}
                  </option>
                )),
              )}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          {currentBinding && (
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
