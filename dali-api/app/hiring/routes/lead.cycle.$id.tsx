import { useState, useEffect, useCallback, useRef } from 'react'
import { cn } from "~/lib/cn";
import { Form, Link, useParams, useLoaderData, useLocation, useSearchParams, useFetcher, redirect } from 'react-router'
import { Select, type SelectOption, Tooltip } from "~/components/ui/floating";
import type { Route } from "./+types/lead.cycle.$id";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCycleAdmin } from "~/lib/roles";
import { changeApplicants } from "~/hiring/lib/cycle-applicants.server";
import { APPLICANT_GROUPS, defaultTimelineFor, isMemberApplicants } from "~/hiring/lib/applicant-groups";
import type { CycleApplicants } from "~/generated/prisma/enums";
import {
  endOfDayInAppTz,
  handleMemberSetupIntent,
  loadMemberCycleSetup,
  loadPhaseStatusByDomain,
  loadTermOptions,
  startOfDayInAppTz,
} from "~/hiring/lib/cycle-setup.server";
import { getCycleProgress } from "~/hiring/lib/cycle-phases.server";
import { defaultApplicationWindow } from "~/hiring/lib/cycle-phases";
import {
  blockKey,
  delibRounds,
  hasInterviews as timelineHasInterviews,
  parseTimeline,
  validateTimeline,
  type Timeline,
} from "~/hiring/lib/cycle-timeline";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";
import { listHiringEmails, saveHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { roundsWithBoards, saveCycleTimeline } from "~/hiring/lib/cycle-timeline.server";
import { buildPhaseTabs, resolvePhaseTab } from "~/hiring/lib/cycle-phase-tabs";
import { TargetDomainsCard } from "~/hiring/components/cycle-setup/TargetDomainsCard";
import { ReviewerPoolCard } from "~/hiring/components/cycle-setup/ReviewerPoolCard";
import { addDomainChallenge, createCycleApplicationForm, removeDomainChallenge } from "~/hiring/lib/application-form.server";
import { parseSessionCookie } from "~/lib/cookies";
import { getPresenceUser } from "~/lib/presence-user";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
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
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { DateField } from "~/components/ui/DateField";
import { useToast } from "~/components/ui/toast";
import { useDialog } from "~/components/ui/dialog";
import { AlertTriangle, Trash2, Plus, CheckCircle, ArrowRight, X, Eye, Mail, CheckCircle2, CircleDot, AlertCircle } from 'lucide-react'
import { useOsChrome } from "~/components/os-chrome";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { buttonClasses } from "~/components/ui/Button";
import { OpenApplicationsConfirmModal } from "~/hiring/components/cycle-setup/OpenApplicationsConfirmModal";
import { TermDatesCard } from "~/hiring/components/cycle-setup/TermDatesCard";
import { AudienceCard } from "~/hiring/components/cycle-setup/AudienceCard";
import { NavSection, SectionNavLayout } from "~/hiring/components/cycle-setup/SectionNav";
import { DomainSubRow, SubRowEmpty } from "~/hiring/components/cycle-setup/DomainSubRow";
import { ChallengeLine, NotReadyIcon, type DomainChallenge } from "~/hiring/components/cycle-setup/ChallengeLine";
import { DomainRosterCard } from "~/hiring/components/cycle-setup/DomainRosterCard";
import { TimelineCard } from "~/hiring/components/cycle-setup/TimelineCard";
import { AlertIcon, Pill, SetupCard, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { DomainStatusList } from "~/hiring/components/cycle-setup/DomainStatusList";
import { formatVersionLabel } from "~/lib/formatVersion";
import { confidentialityBlock, getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { sendExtensionNoticeIfDue, resendExtensionNotice } from "~/hiring/lib/extension-notice";
import { ConfidentialityGate } from "~/hiring/components/ConfidentialityGate";
import { ConfidentialityAgreementPicker } from "~/hiring/components/ConfidentialityAgreementPicker";
import { STATUS_TONES, STATUS_LABELS } from "~/hiring/lib/labels";
import {
  zonedDayStartUtc,
  zonedDayEndUtc,
  getZonedYMD,
  APPLICATION_TZ,
  APPLICATION_TZ_LABEL,
} from "~/lib/timezone";

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
  bookingNoticeHours: number
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
  videoUrl: string | null
  domainApplication: {
    id: string
    domain: { name: string }
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

interface PendingInviteRow {
  id: string
  invitedAt: string
  domainApplication: {
    id: string
    domain: { name: string }
    application: { user: { id: string; firstName: string | null; lastName: string | null } }
  }
}

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as any)?.cycle?.name;
  return [{ title: `${name || "Cycle"} · Hiring lead · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  // Lab members cycles are Admin-only; everything else is the Core tier.
  if (!(await isCycleAdmin(auth.user.sub, params.id))) return redirect("/");

  // Hiring leads must be able to reach this page to bind a confidentiality
  // agreement to the cycle, so we don't redirect when unsigned. Instead, the
  // loader strips every sensitive payload — applicant identities, final
  // decisions, review counts — and the UI shows a placeholder where those
  // panels would be.
  const confState = await getCycleConfidentialityState(auth.user.sub, params.id);
  const confidentialityRequired = confidentialityBlock(confState);

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
      applicationForm: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } },
      domainChallengeForms: { select: { id: true, domainId: true, formId: true, form: { select: { name: true } } } },
    },
  });

  // After the Core gate — this cycle lands in the lead's recents.
  recordRouteVisit(auth.user.sub, `/hiring/lead/cycle/${params.id}`, cycleBase.name, request);

  const applications = confidentialityRequired
    ? []
    : await prisma.application.findMany({
        where: { applicationCycleId: params.id },
        include: {
          user: true,
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domainApplications: {
            where: { selected: true },
            include: { domain: true },
          },
        },
      });
  const cycle = { ...cycleBase, applications };

  const allDomains = await prisma.domain.findMany({ orderBy: { name: "asc" } });

  // All Drive Forms — for the "bind a different form" picker in Setup.
  const allForms = await prisma.form.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const rubricVersionOptions = await prisma.rubricVersion.findMany({
    include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Confidentiality agreements are SigningDocuments (kind Confidentiality),
  // bound to the cycle via a SigningBinding (scopeKey "cycle:<id>") and signed
  // as SigningSignatures (roleKey "member"). Reshaped to the picker's original
  // shape so its UI is unchanged.
  const confidentialityAgreementOptions = await prisma.signingDocument.findMany({
    where: { gateScope: "HiringCycle", archivedAt: null },
    include: { versions: { orderBy: { versionNumber: "desc" } } },
    orderBy: { name: "asc" },
  });
  const confidentialityBindingRow = await prisma.signingBinding.findFirst({
    where: { cycleId: params.id, document: { gateScope: "HiringCycle" } },
    include: {
      version: { include: { document: { select: { name: true } } } },
    },
  });
  const currentConfidentialityBinding = confidentialityBindingRow
    ? {
        confidentialityAgreementVersion: {
          id: confidentialityBindingRow.version.id,
          versionNumber: confidentialityBindingRow.version.versionNumber,
          agreement: { name: confidentialityBindingRow.version.document.name },
        },
      }
    : null;
  const confidentialitySignatures = (
    await prisma.signingSignature.findMany({
      where: {
        roleKey: "member",
        binding: { cycleId: params.id, document: { gateScope: "HiringCycle" } },
      },
      include: { signer: { select: { firstName: true, lastName: true } } },
      orderBy: { signedAt: "asc" },
    })
  ).map((s) => ({ user: s.signer }));

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

  // Which domains already have reviews assigned (used to gate rubric edits —
  // once any domain application has a review, changing the rubric out from
  // under it would invalidate scoring).
  const domainIds: string[] = cycle.domains.map((d: any) => d.domainId);
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
            },
          },
        },
      });
  const reviewedDomainIdSet = new Set<string>();
  for (const r of reviewsForCycle) {
    const did = r.domainApplication.domainId ?? null;
    if (did) reviewedDomainIdSet.add(did);
  }
  const reviewedDomainIds = Array.from(reviewedDomainIdSet);

  // Decisions awaiting the hiring lead: Drafts to finalize and Finals to
  // release, on every kind of cycle. Students cycles used to load Finals only,
  // on the theory that domain leads finalize on their own page — but a Draft
  // made outside that flow (moved by hand, or left behind when the cycle
  // closed) was then invisible here, which is the one place a lead looks.
  // Exclude rows that already have a Released child — Decision is append-only,
  // so released rows still match their stage and would otherwise re-appear here
  // after the optimistic UI update is undone by a loader refetch.
  const isMemberCycle = isMemberApplicants(cycleBase.applicants);
  const pendingDecisions = confidentialityRequired
    ? []
    : await prisma.decision.findMany({
        where: {
          stage: { in: ["Draft", "Final"] },
          children: { none: { stage: "Released" } },
          domainApplication: {
            application: { applicationCycleId: params.id },
          },
        },
        include: {
          domainApplication: {
            include: {
              application: { include: { user: { select: { firstName: true, lastName: true, dartmouthEmail: true, netId: true } } } },
              domain: { select: { name: true } },
            },
          },
          madeBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      });

  // Hiring's emails are shared by every cycle, one per slot (decision or
  // notification). Keyed by slot for the editors, release gating and previews.
  const hiringEmails: Record<string, { subject: string; body: string }> = Object.fromEntries(
    (await listHiringEmails()).map((e) => [e.slot, { subject: e.subject, body: e.body }]),
  );

  // Domain leads per cycle domain, used to name who owes a missing
  // challenge. DomainLeadAssignment has no "current" flag;
  // ordering by createdAt desc picks the most-recently-assigned lead first,
  // and we dedupe by user across terms.
  const domainLeadAssignments = domainIds.length > 0
    ? await prisma.domainLeadAssignment.findMany({
        where: { domainId: { in: domainIds } },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const domainLeadsByDomain: Record<string, Array<{ id: string; firstName: string | null; lastName: string | null }>> = {};
  for (const a of domainLeadAssignments) {
    const list = (domainLeadsByDomain[a.domainId] ??= []);
    if (!list.some((u) => u.id === a.user.id)) list.push(a.user);
  }

  const memberSetup = isMemberCycle ? await loadMemberCycleSetup(params.id) : null;
  const [progress, termOptions, phaseStatusByDomain] = await Promise.all([
    getCycleProgress(params.id),
    loadTermOptions(request),
    confidentialityRequired ? null : loadPhaseStatusByDomain(params.id),
  ]);

  const collabToken = parseSessionCookie(request);
  const presenceUser = await getPresenceUser(auth.user.sub);

  return {
      cycle,
      memberSetup,
      progress,
      roundsWithBoards: [...(await roundsWithBoards(params.id))],
      termOptions,
      viewerIsAdmin: await isAdmin(auth.user.sub),
      phaseStatusByDomain,
      allDomains,
      allForms,
      pendingDecisions,
      rubricVersionOptions,
      cycleApplicationReviewCount,
      hiringEmails,
      domainRubricVersions,
      reviewedDomainIds,
      domainLeadsByDomain,
      confidentialityAgreementOptions,
      currentConfidentialityBinding,
      confidentialitySignatures,
      confidentialityRequired,
      collabToken,
      currentUserId: auth.user.sub,
      presenceUserName: presenceUser?.name ?? auth.user.email,
      presencePhotoUrl: presenceUser?.photoUrl ?? null,
      presenceSubtitle: presenceUser?.subtitle ?? null,
    };
}

// ─── Action ──────────────────────────────────────────────────────────────────

/**
 * Redirect back to the same cycle page, preserving the active ?tab= so a form
 * submission on (e.g.) Setup doesn't bounce the user to another phase. Extra params
 * (e.g. notice keys) are appended after.
 */
function cycleRedirect(
  request: Request,
  cycleId: string,
  extra?: Record<string, string | number>,
) {
  const tab = new URL(request.url).searchParams.get("tab");
  const sp = new URLSearchParams();
  if (tab) sp.set("tab", tab);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) sp.set(k, String(v));
  }
  const qs = sp.toString();
  return redirect(`/hiring/lead/cycle/${cycleId}${qs ? `?${qs}` : ""}`);
}

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
  if (!(await isCycleAdmin(auth.user.sub, params.id))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  // Captured after the auth check so the helper closures below see it narrowed.
  const actorId = auth.user.sub;

  const cycleRow = await prisma.applicationCycle.findUnique({
    where: { id: params.id },
    select: { applicants: true },
  });
  if (!cycleRow) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  const memberResult = isMemberApplicants(cycleRow.applicants)
    ? await handleMemberSetupIntent(intent, formData, params.id, cycleRow.applicants)
    : null;
  if (memberResult) return memberResult;

  if (intent === "set-stages") {
    const stage = formData.get("stage") as string;
    // Delib rounds and Interviews live on the timeline now (set-timeline).
    if (stage !== "hasChallenges") {
      return Response.json({ error: "Unknown stage" }, { status: 400 });
    }
    const latest = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
      select: { newStatus: true },
    });
    if ((latest?.newStatus ?? "Draft") !== "Draft") {
      return Response.json({ error: "Stages lock once the cycle opens." }, { status: 409 });
    }
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { [stage]: formData.get("value") === "true" },
    });
    return { ok: true };
  }

  // Term and application dates. Shared by their single-field intents and the
  // Term and dates card's one Save.
  async function applyTerm(termId: string | null, fillDefaultWindow: boolean): Promise<Response | null> {
    const term = termId
      ? await prisma.term.findUnique({ where: { id: termId }, select: { startDate: true } })
      : null;
    if (termId && !term) return Response.json({ error: "Unknown term" }, { status: 400 });
    const dates = await prisma.applicationCycle.findUnique({
      where: { id: params.id },
      select: { openDate: true, closeDate: true },
    });
    // A new cycle gets the standard window (Weeks 4 to 5) as a starting point;
    // dates a lead already chose are never overwritten.
    const window =
      fillDefaultWindow && term && !dates?.openDate && !dates?.closeDate
        ? defaultApplicationWindow(term.startDate)
        : null;
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: {
        termId,
        ...(window && {
          openDate: startOfDayInAppTz(window.open),
          closeDate: endOfDayInAppTz(window.closeDay),
        }),
      },
    });
    return null;
  }

  async function applyOpenDate(raw: string | null): Promise<Date | null> {
    let openDate: Date | null = null;
    if (raw) {
      const [y, m, d] = raw.split("-").map(Number);
      openDate = zonedDayStartUtc(y, m, d, APPLICATION_TZ);
    }
    await prisma.applicationCycle.update({ where: { id: params.id }, data: { openDate } });
    return openDate;
  }

  /** Returns the notice to show. */
  async function applyCloseDate(raw: string | null): Promise<string> {
    let parsedClose: Date | null = null;
    if (raw) {
      // Deadline is 11:59:59 PM Eastern on the selected date so applicants get
      // the full day in the lab's local time (not late evening UTC).
      const [y, m, d] = raw.split("-").map(Number);
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
    // A past close on an Open cycle would flip it to UnderReview on the next
    // loader hit (autoCloseIfExpired). That's almost never what a lead means
    // when editing a live cycle; closing early is the status control's job.
    if (
      nextClose &&
      nextClose.getTime() < Date.now() &&
      cycle?.statusUpdates[0]?.newStatus === "Open"
    ) {
      return "deadline-past";
    }
    const reopened = await prisma.$transaction(async (tx) => {
      await tx.applicationCycle.update({
        where: { id: params.id },
        data: { closeDate: nextClose, originalCloseDate: nextOriginal },
      });
      return await reopenIfNeeded(tx, params.id!, cycle, nextClose, actorId);
    });
    return parsedClose ? (reopened ? "deadline-set-reopened" : "deadline-set") : "deadline-cleared";
  }

  if (intent === "save-term-dates") {
    const termId = (formData.get("termId") as string) || null;
    const openRaw = (formData.get("openDate") as string) || null;
    const closeRaw = (formData.get("closeDate") as string) || null;
    const before = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.id },
      select: {
        termId: true,
        openDate: true,
        closeDate: true,
        originalCloseDate: true,
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1, select: { newStatus: true } },
      },
    });
    const ymd = (d: Date | null) => {
      if (!d) return null;
      const { year, month, day } = getZonedYMD(d, APPLICATION_TZ);
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };
    // A fresh term with no dates picked yet gets the default window; dates
    // entered in the same save win over it.
    const bad = await applyTerm(termId, !openRaw && !closeRaw);
    if (bad) return bad;
    // Only touch a date that actually changed, so saving the term alone never
    // disturbs an active extension. The open date is fixed once applications open.
    if (openRaw !== ymd(before.openDate) && (before.statusUpdates[0]?.newStatus ?? "Draft") === "Draft") {
      await applyOpenDate(openRaw);
    }
    if (closeRaw !== ymd(before.originalCloseDate ?? before.closeDate) && (openRaw || closeRaw || before.closeDate)) {
      const notice = await applyCloseDate(closeRaw);
      if (notice === "deadline-past") return cycleRedirect(request, params.id!, { notice });
    }
    return cycleRedirect(request, params.id!, { notice: "term-dates-saved" });
  }

  if (intent === "set-applicants") {
    const next = formData.get("applicants") as CycleApplicants;
    if (!APPLICANT_GROUPS.includes(next)) {
      return Response.json({ error: "Unknown applicant group" }, { status: 400 });
    }
    const error = await changeApplicants(params.id, next, await isAdmin(auth.user.sub));
    if (error === "not-draft") {
      return Response.json({ error: "Applicants lock once the cycle opens." }, { status: 409 });
    }
    if (error === "admin-only") {
      return Response.json({ error: "Only Admins can run Lab members cycles." }, { status: 403 });
    }
    return cycleRedirect(request, params.id!, { notice: "applicants-changed" });
  }

  if (intent === "set-timeline") {
    const reset = !!formData.get("reset");
    let next: Timeline;
    try {
      next = reset ? defaultTimelineFor(cycleRow.applicants) : JSON.parse(formData.get("timeline") as string);
    } catch {
      next = null as unknown as Timeline;
    }
    if (!Array.isArray(next) || !next.every((b) => b && typeof b === "object" && Array.isArray(b.weeks))) {
      return Response.json({ error: "Couldn't read the timeline." }, { status: 400 });
    }
    const invalid = validateTimeline(next);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    // Moving weeks or renaming rounds is fine anytime; adding or removing
    // blocks changes who gets decided when, so only in Draft.
    const [stored, latest] = await Promise.all([
      prisma.applicationCycle.findUnique({ where: { id: params.id }, select: { timeline: true } }),
      prisma.applicationCycleStatusUpdate.findFirst({
        where: { applicationCycleId: params.id },
        orderBy: { createdAt: "desc" },
        select: { newStatus: true },
      }),
    ]);
    const shape = (t: Timeline) => t.map(blockKey).join(",");
    if (
      (latest?.newStatus ?? "Draft") !== "Draft" &&
      shape(parseTimeline(stored?.timeline)) !== shape(next)
    ) {
      return Response.json({ error: "Rounds and Interviews lock once the cycle opens." }, { status: 409 });
    }
    const error = await saveCycleTimeline(params.id, next);
    if (error) return Response.json({ error }, { status: 400 });
    return cycleRedirect(request, params.id!, { notice: reset ? "timeline-reset" : "timeline-saved" });
  }

  if (intent === "create-challenge-form" || intent === "remove-challenge-form") {
    const refused =
      intent === "create-challenge-form"
        ? await addDomainChallenge(params.id, formData.get("domainId") as string, auth.user.sub)
        : await removeDomainChallenge(formData.get("cdfId") as string, params.id);
    if (refused === "not-draft") {
      return Response.json({ error: "Challenges lock once the cycle opens." }, { status: 409 });
    }
    if (refused === "in-use") {
      return Response.json({ error: "An applicant already picked this challenge." }, { status: 409 });
    }
    if (refused === "not-found") return Response.json({ error: "Not found" }, { status: 404 });
    return cycleRedirect(request, params.id!);
  }

  if (intent === "set-term") {
    const bad = await applyTerm((formData.get("termId") as string) || null, true);
    return bad ?? cycleRedirect(request, params.id!);
  }

  if (intent === "set-open-date") {
    const openDate = await applyOpenDate((formData.get("openDate") as string) || null);
    return cycleRedirect(request, params.id!, { notice: openDate ? "open-date-set" : "open-date-cleared" });
  }

  if (intent === "set-close-date") {
    const notice = await applyCloseDate((formData.get("closeDate") as string) || null);
    return cycleRedirect(request, params.id!, { notice });
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
    return cycleRedirect(request, params.id!, { notice });
  }

  if (intent === "remove-extension") {
    const cycle = await prisma.applicationCycle.findUnique({
      where: { id: params.id },
    });
    if (!cycle?.originalCloseDate) {
      // No extension to remove — just no-op.
      return cycleRedirect(request, params.id!);
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
    return cycleRedirect(request, params.id!, { notice: "extension-removed" });
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
    return cycleRedirect(request, params.id!, {
      notice,
      sent: result.succeeded,
      failed: result.failed,
      skipped: result.alreadySent,
    });
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
      return cycleRedirect(request, params.id!);
    }
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { generalRubricVersionId: rubricVersionId },
    });
    return cycleRedirect(request, params.id!);
  }

  if (intent === "set-anonymize-review") {
    // Blind review toggle. Unchecked checkboxes are omitted from the form body,
    // so absence means "off".
    const anonymizeReview = formData.get("anonymizeReview") === "on";
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { anonymizeReview },
    });
    return cycleRedirect(request, params.id!);
  }

  if (intent === "set-confidentiality-agreement") {
    const versionId =
      (formData.get("confidentialityAgreementVersionId") as string) || null;
    const cycleId = params.id!;
    const scopeKey = `cycle:${cycleId}`;
    const existing = await prisma.signingBinding.findFirst({
      where: { cycleId, document: { gateScope: "HiringCycle" } },
      select: { id: true },
    });
    if (versionId) {
      const version = await prisma.signingDocumentVersion.findUnique({
        where: { id: versionId },
        select: { documentId: true },
      });
      if (version) {
        if (existing) {
          // Update in place so existing signatures survive the version bump
          // (they no longer match the new version → members re-sign).
          await prisma.signingBinding.update({
            where: { id: existing.id },
            data: { versionId, documentId: version.documentId, scopeKey },
          });
        } else {
          await prisma.signingBinding.create({
            data: { documentId: version.documentId, versionId, scopeKey, cycleId },
          });
        }
      }
    } else if (existing) {
      // Unbind: removing the binding returns the cycle to the no_agreement
      // state (cascades away its signatures).
      await prisma.signingBinding.delete({ where: { id: existing.id } });
    }
    return cycleRedirect(request, params.id!);
  }

  if (intent === "add-domain-mentors") {
    const role = formData.get("role");
    if (role !== "reviewer" && role !== "interviewer") {
      return Response.json({ error: "Unknown roster" }, { status: 400 });
    }
    const domainId = formData.get("domainId") as string;
    const inCycle = await prisma.domainApplicationCycle.findUnique({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      select: { domainId: true },
    });
    if (!inCycle) return Response.json({ error: "That domain isn't in this cycle." }, { status: 400 });
    const added = await addDomainMentors(params.id, domainId, role, request);
    // Nothing added means either no mentors, or all of them already on it.
    const notice =
      added > 0 ? "mentors-added" : (await domainMentorIds(domainId, request)).length ? "mentors-already" : "mentors-none";
    return cycleRedirect(request, params.id!, { notice, added });
  }

  if (intent === "save-hiring-email") {
    // One email per slot, shared by every cycle. Saving it empty turns it off.
    const slot = formData.get("slot") as string;
    if (!(slot in TEMPLATE_VARIABLES)) {
      return Response.json({ error: "Unknown email" }, { status: 400 });
    }
    await saveHiringEmail(
      slot as TemplateSlot,
      { subject: (formData.get("subject") as string) ?? "", body: (formData.get("body") as string) ?? "" },
      auth.user.sub,
    );
    return { ok: true };
  }


  if (intent === "create-application-form") {
    // Auto-create + bind a Drive Form as this cycle's general application form
    // (no-op if already bound). Takes precedence over any legacy general-form link.
    await createCycleApplicationForm(params.id!, auth.user.sub);
    return cycleRedirect(request, params.id!);
  }

  if (intent === "set-application-form") {
    const formId = (formData.get("formId") as string) || null;
    await prisma.applicationCycle.update({
      where: { id: params.id! },
      data: { applicationFormId: formId },
    });
    return cycleRedirect(request, params.id!);
  }

  if (intent === "hl-set-domain-rubric") {
    const domainId = formData.get("domainId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    if (!domainId) {
      return cycleRedirect(request, params.id!);
    }
    // Once any review is assigned for this domain in this cycle, the rubric
    // is locked: changing it would silently invalidate prior scores.
    const hasAssignedReviews = await prisma.applicationReview.count({
      where: {
        domainApplication: {
          domainId,
          application: { applicationCycleId: params.id },
        },
      },
    });
    if (hasAssignedReviews > 0) {
      return cycleRedirect(request, params.id!);
    }
    if (rubricVersionId) {
      const rv = await prisma.rubricVersion.findUnique({
        where: { id: rubricVersionId },
      });
      if (!rv) {
        return cycleRedirect(request, params.id!);
      }
    }
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      update: { rubricVersionId },
      create: { domainId, applicationCycleId: params.id, rubricVersionId },
    });
    return cycleRedirect(request, params.id!);
  }

  if (intent === "hl-force-mark-ready" || intent === "hl-force-unmark-ready") {
    const domainId = formData.get("domainId") as string;
    const confirm = formData.get("confirm");
    if (!domainId || confirm !== "true") {
      return cycleRedirect(request, params.id!);
    }
    const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: params.id },
      orderBy: { createdAt: "desc" },
    });
    if ((latestUpdate?.newStatus ?? "Draft") !== "Draft") {
      return cycleRedirect(request, params.id!);
    }
    const isReady = intent === "hl-force-mark-ready";
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
      update: { isReady },
      create: { domainId, applicationCycleId: params.id, isReady },
    });
    return cycleRedirect(request, params.id!);
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
    return cycleRedirect(request, params.id!);
  }

  return cycleRedirect(request, params.id!);
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
  slots: {
    startTime: string
    endTime: string
    freeInterviewerCount: number
    freeInterviewers?: { id: string; firstName: string | null; lastName: string | null; domains: string[] }[]
    bookedInterviewCount: number
  }[]
  slotDurationMinutes: number
  timezone: string
  totalInterviewers?: number
}

// A list filter: "all" plus each value present in the list.
function FilterSelect({ label, value, onChange, allLabel, values }: {
  label: string
  value: string
  onChange: (v: string) => void
  allLabel: string
  values: string[]
}) {
  const { formTrigger } = useOsChrome()
  return (
    <div className="w-48">
      <Select
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={[{ value: 'all', label: allLabel }, ...values.map((v): SelectOption => ({ value: v, label: v }))]}
        buttonClassName={rowTrigger(formTrigger)}
      />
    </div>
  )
}

function CoverageHeatmap({ coverage }: { coverage: CoverageData | null }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const { bodyText } = useOsChrome()
  if (coverage && !coverage.configured) return null
  if (!coverage || coverage.slots.length === 0) {
    return (
      <SetupCard title="Availability coverage">
        <p className={cn(bodyText, 'py-3 text-center')}>
          {coverage ? 'No future slots in the interview window.' : 'Loading…'}
        </p>
      </SetupCard>
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
  const allTimes = Array.from(timeKeys).sort()

  // Lookup: (dayKey, timeKey) -> slot
  const lookup = new Map<string, typeof coverage.slots[number]>()
  for (const slot of coverage.slots) {
    const d = new Date(slot.startTime)
    const dayKey = d.toLocaleDateString('en-CA', { timeZone: tz })
    const timeKey = d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    lookup.set(`${dayKey}|${timeKey}`, slot)
  }

  // Rows where at least one day has free interviewers or a booked interview.
  // These are the "interesting" rows — most slots end up all-zero.
  const activeTimes = allTimes.filter((time) =>
    days.some((day) => {
      const s = lookup.get(`${day}|${time}`)
      return s && (s.freeInterviewerCount > 0 || s.bookedInterviewCount > 0)
    }),
  )
  const hiddenCount = allTimes.length - activeTimes.length
  const times = showEmpty ? allTimes : activeTimes

  // Totals
  const totalFreeHours = coverage.slots.reduce((sum, s) => sum + (s.freeInterviewerCount * coverage.slotDurationMinutes) / 60, 0)
  const totalBooked = coverage.slots.reduce((sum, s) => sum + s.bookedInterviewCount, 0)
  const slotHours = coverage.slotDurationMinutes / 60

  function cellColor(freeCount: number) {
    if (freeCount === 0) return 'bg-muted/40 text-muted-foreground'
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
    <SetupCard
      title="Availability coverage"
      description={`${totalFreeHours.toFixed(0)} interviewer-hours offered · ${totalBooked} booked · ${slotHours < 1 ? `${coverage.slotDurationMinutes} min` : `${slotHours} h`} slots`}
      action={
        hiddenCount > 0 && (
          <button type="button" onClick={() => setShowEmpty((v) => !v)} className={buttonClasses('ghost', 'sm')}>
            {showEmpty ? `Hide ${hiddenCount} empty slot${hiddenCount === 1 ? '' : 's'}` : `Show ${hiddenCount} empty slot${hiddenCount === 1 ? '' : 's'}`}
          </button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="text-[11px] border-separate border-spacing-[2px] leading-none">
          <thead>
            <tr>
              <th className="text-left px-1.5 py-0.5 text-os-grey font-medium sticky left-0 bg-os-card z-10">Time</th>
              {days.map((day) => (
                <th key={day} className="px-1.5 py-0.5 text-center font-semibold text-foreground/80 whitespace-nowrap">
                  {formatDay(day)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time}>
                <td className="px-1.5 py-0.5 text-right text-os-grey font-medium sticky left-0 bg-os-card whitespace-nowrap">
                  {formatTime(time)}
                </td>
                {days.map((day) => {
                  const slot = lookup.get(`${day}|${time}`)
                  if (!slot) {
                    return <td key={`${day}-${time}`} className="px-1.5 py-0.5 bg-transparent" />
                  }
                  const free = slot.freeInterviewerCount
                  const booked = slot.bookedInterviewCount
                  const namesList = (slot.freeInterviewers ?? [])
                    .map((p) => {
                      const n = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || '?'
                      return p.domains.length > 0 ? `${n} (${p.domains.join(', ')})` : n
                    })
                  const tooltip = `${free} interviewer${free === 1 ? '' : 's'} free${booked > 0 ? ` · ${booked} booked` : ''}${
                    namesList.length > 0 ? `\n${namesList.join('\n')}` : ''
                  }`
                  return (
                    <td
                      key={`${day}-${time}`}
                      title={tooltip}
                      className={`px-1.5 py-0.5 text-center font-semibold rounded ${cellColor(free)} relative min-w-[36px]`}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-os-grey">
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
    </SetupCard>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────

type DecisionSlice = 'invites' | 'finalize' | 'outcomes'

const DECISION_SLICES: Record<DecisionSlice, { title: string; empty: string; include: (d: any) => boolean }> = {
  invites: {
    title: 'Interview invites',
    empty: 'No invites ready to send.',
    include: (d) => d.stage === 'Final' && d.type === 'InvitedToInterview',
  },
  finalize: {
    title: 'Draft decisions',
    empty: 'No drafts to finalize. Close final delibs to create them.',
    include: (d) => d.stage === 'Draft',
  },
  outcomes: {
    title: 'Decisions ready to release',
    empty: 'No decisions awaiting release.',
    include: (d) => d.stage === 'Final' && d.type !== 'InvitedToInterview',
  },
}

export default function HiringLeadCycleDetails() {
  const toast = useToast()
  const dialog = useDialog()
  const { id: cycleId } = useParams()
  const loaderData = useLoaderData<typeof loader>() as any
  const os = useOsChrome()
  const cycle = loaderData?.cycle
  const memberSetup = loaderData?.memberSetup ?? null
  const isMemberCycle = memberSetup !== null
  const domainsTitle =
    cycle?.applicants === 'LabMembers' ? 'Applicant pool' : isMemberCycle ? 'Target domains' : 'Domains'
  // A domain's challenges, shown on its row only when the cycle has them.
  const challengeFor = (domainId: string): DomainChallenge | null => {
    if (!cycle?.hasChallenges) return null
    const lead = (loaderData?.domainLeadsByDomain?.[domainId] ?? [])[0]
    return {
      forms: (cycle?.domainChallengeForms ?? [])
        .filter((f: any) => f.domainId === domainId)
        .map((f: any) => ({ id: f.id, formId: f.formId, name: f.form.name })),
      lead: lead ? `${lead.firstName ?? ''} ${lead.lastName ?? ''}`.trim() || null : null,
    }
  }

  const timeline: Timeline = parseTimeline(loaderData?.progress?.timeline)
  const rounds = delibRounds(timeline)
  const hasInterviews = timelineHasInterviews(timeline)

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
    bookingNoticeHours: 12,
    timezone: APPLICATION_TZ,
  })
  const [configSaved, setConfigSaved] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

  // ── Reviewers state ──
  const [reviewers, setReviewers] = useState<CycleReviewer[]>([])
  const [allMembers, setAllMembers] = useState<{ id: string; daliEmail: string; firstName?: string | null; lastName?: string | null }[]>([])

  // ── Interviewers state ──
  const [interviewers, setInterviewers] = useState<any[]>([])

  // ── Interviews state ──
  const [interviews, setInterviews] = useState<InterviewRow[]>([])
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([])
  // Per-row id while a Resend invite is in-flight; null when idle.
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null)
  // Filters for the interviews table — domain + status. "all" disables.
  const [interviewDomainFilter, setInterviewDomainFilter] = useState<string>('all')
  const [interviewStatusFilter, setInterviewStatusFilter] = useState<string>('all')
  // Cancelled interviews are hidden by default — they duplicate the
  // "Awaiting Schedule" row for the same applicant and clutter the
  // "what comes next" view.
  const [showCancelledInterviews, setShowCancelledInterviews] = useState<boolean>(false)

  // ── Coverage heatmap state ──
  const [coverage, setCoverage] = useState<{
    configured: boolean
    slots: { startTime: string; endTime: string; freeInterviewerCount: number; bookedInterviewCount: number }[]
    slotDurationMinutes: number
    timezone: string
    totalInterviewers?: number
  } | null>(null)

  // ── Cycle status ──
  // Hydrate from the loader's statusUpdates so reload renders the correct
  // status on the first paint. loadStatus() re-fetches via /api shortly after
  // mount to pick up any server-side transition (e.g. auto-close) since the
  // loader ran.
  const [cycleStatus, setCycleStatus] = useState<string>(
    cycle?.statusUpdates?.[0]?.newStatus ?? 'Draft'
  )
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [showOpenConfirm, setShowOpenConfirm] = useState(false)

  const STATUS_FLOW = ['Draft', 'Open', 'UnderReview', 'Completed'] as const

  // ── Active tab (URL-synced: deep-links, reload, and back/forward all work) ──
  const [searchParams, setSearchParams] = useSearchParams()
  // Tabs are the timeline's blocks; ?tab= holds the block key (a phase key,
  // or `delib:<id>` for a round).
  const termStart: Date | null = loaderData?.progress?.term ? new Date(loaderData.progress.term.startDate) : null
  const phaseTabs = buildPhaseTabs(
    timeline,
    { hasChallenges: !!cycle?.hasChallenges },
    loaderData?.progress?.done ?? {},
    termStart,
  )
  const tab = resolvePhaseTab(searchParams.get('tab'), phaseTabs, timeline)
  const activeRound = rounds.find(r => `delib:${r.id}` === tab) ?? null
  const setTab = useCallback((next: string) => {
    setSearchParams(prev => {
      const sp = new URLSearchParams(prev)
      sp.set('tab', next)
      return sp
    }, { preventScrollReset: true })
  }, [setSearchParams])

  // ── Decisions state ──
  const [pendingDecisions, setPendingDecisions] = useState<any[]>(loaderData?.pendingDecisions ?? [])
  const [releasing, setReleasing] = useState<string | null>(null)
  const [releasingAll, setReleasingAll] = useState(false)

  // Release a single decision behind a confirm — sends an irreversible email.
  async function confirmReleaseOne(d: any) {
    if (releasing === d.id) return
    if (
      !(await dialog.confirm({
        title: `Release this decision to ${d.domainApplication.application.user.firstName}?`,
        description:
          "This emails the applicant their decision. It can't be undone.",
        confirmLabel: "Release",
        tone: "destructive",
      }))
    )
      return
    setReleasing(d.id)
    await fetch(`/api/hiring/decisions/${d.id}/release`, { method: 'POST', credentials: 'include' })
    setPendingDecisions(prev => prev.filter(p => p.id !== d.id))
    setReleasing(null)
  }
  // Member cycles have no domain-lead finalize step, so the lead promotes
  // Draft decisions to Final here before releasing them.
  const [finalizing, setFinalizing] = useState(false)
  async function finalizeDecisions(ids: string[]) {
    if (finalizing || ids.length === 0) return
    setFinalizing(true)
    try {
      for (const id of ids) {
        const res = await fetch(`/api/hiring/decisions/${id}/finalize`, { method: 'POST', credentials: 'include' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          toast.error(body.error ?? `Couldn't finalize (HTTP ${res.status}).`)
          return
        }
        const newFinal = await res.json()
        setPendingDecisions(prev => prev.map(p => (p.id === id ? { ...p, id: newFinal.id, stage: 'Final' } : p)))
      }
    } finally {
      setFinalizing(false)
    }
  }
  const [previewDecisionId, setPreviewDecisionId] = useState<string | null>(null)
  const [decisionDomainFilter, setDecisionDomainFilter] = useState<string>('all')
  const [decisionTypeFilter, setDecisionTypeFilter] = useState<string>('all')

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
      // Reviewer assignment is current-cycle work — exclude alumni so a stale
      // suggestion can't pick someone who's no longer on the lab roster.
      const r = await fetch('/api/members?scope=current', { credentials: 'include' })
      setAllMembers(r.ok ? await r.json() : [])
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
      if (!r.ok) {
        setInterviews([])
        setPendingInvites([])
        return
      }
      const body = await r.json()
      // Tolerate the legacy array shape so reverting the API doesn't break
      // the client; new shape returns { interviews, pending }.
      setInterviews(Array.isArray(body) ? body : (body.interviews ?? []))
      setPendingInvites(Array.isArray(body) ? [] : (body.pending ?? []))
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
  // Member cycles keep their reviewer pool in the loader; the per-domain
  // roster and everything interview-related only exist for some cycles.
  useEffect(() => {
    if (!cycleId) return
    loadStatus()
    if (!isMemberCycle) loadReviewers()
    // Member pickers feed the per-domain reviewer and interviewer rosters.
    if (!isMemberCycle || hasInterviews) {
      loadMembers()
    }
    if (hasInterviews) {
      loadConfig()
      loadInterviewers()
      loadInterviews()
      loadCoverage()
    }
  }, [cycleId, isMemberCycle, hasInterviews, loadStatus, loadConfig, loadReviewers, loadMembers, loadInterviewers, loadInterviews, loadCoverage])

  // An action on this page (e.g. adding a domain's mentors) revalidates the
  // loader but not these client-fetched rosters, so refetch them with it.
  useEffect(() => {
    if (!cycleId) return
    if (!isMemberCycle) loadReviewers()
    if (hasInterviews) loadInterviewers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData])

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

  async function addReviewer(userId: string, domainId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, domainId }),
    })
    // The POST row lacks the user/domain relations the list shows; refetch.
    if (res.ok) await loadReviewers()
  }

  async function removeReviewer(reviewerId: string) {
    if (!cycleId) return
    const reviewer = reviewers.find(r => r.id === reviewerId)
    const name = reviewer
      ? (reviewer.user?.firstName && reviewer.user?.lastName
          ? `${reviewer.user.firstName} ${reviewer.user.lastName}`
          : reviewer.user?.daliEmail ?? 'this reviewer')
      : 'this reviewer'
    if (
      !(await dialog.confirm({
        title: `Remove ${name} as a reviewer?`,
        description: 'They will no longer be assignable to applicants in this domain. Any reviews already submitted will be deleted.',
        confirmLabel: 'Remove reviewer',
        tone: 'destructive',
      }))
    )
      return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setReviewers(prev => prev.filter(r => r.id !== reviewerId))
    }
  }

  async function addInterviewer(userId: string, domainId: string) {
    if (!cycleId) return
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, domainId }),
    })
    // POST returns the bare cycleInterviewer row without user/domain
    // relations; refetch so the row matches the server shape exactly.
    if (res.ok) await loadInterviewers()
  }

  async function removeInterviewer(interviewerId: string) {
    if (!cycleId) return
    const interviewer = (interviewers as any[]).find((i: any) => i.id === interviewerId)
    const name = interviewer
      ? (interviewer.user?.firstName && interviewer.user?.lastName
          ? `${interviewer.user.firstName} ${interviewer.user.lastName}`
          : interviewer.user?.daliEmail ?? 'this interviewer')
      : 'this interviewer'
    if (
      !(await dialog.confirm({
        title: `Remove ${name} as an interviewer?`,
        confirmLabel: 'Remove interviewer',
        tone: 'destructive',
      }))
    )
      return
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

  // The pending-decisions list, sliced by phase: invites go out in Review,
  // member cycles finalize Drafts in Final delibs, outcomes release in
  // Decisions. Release and finalize behave the same everywhere.
  function renderDecisions(kind: DecisionSlice) {
    if (loaderData?.confidentialityRequired) {
      return (
        <ConfidentialityGate
          cycleId={cycleId ?? ''}
          reason={loaderData.confidentialityRequired}
          next={`/hiring/lead/cycle/${cycleId}?tab=${tab}`}
        />
      )
    }
    const scoped = pendingDecisions.filter(DECISION_SLICES[kind].include)
    // A decision type can be released once it has an email written.
    const boundTypes = new Set(
      Object.keys(loaderData?.hiringEmails ?? {})
        .filter((slot) => slot.startsWith('decision:'))
        .map((slot) => slot.slice('decision:'.length))
    )
    const domainNameOf = (d: any) =>
      d.domainApplication.domain?.name ?? ''
    const availableDomains = Array.from(
      new Set(scoped.map(domainNameOf))
    ).sort()
    const availableTypes = Array.from(
      new Set(scoped.map((d: any) => d.type as string))
    ).sort()
    const filtersActive = decisionDomainFilter !== 'all' || decisionTypeFilter !== 'all'
    const filteredDecisions = scoped.filter((d: any) => {
      if (decisionDomainFilter !== 'all' && domainNameOf(d) !== decisionDomainFilter) return false
      if (decisionTypeFilter !== 'all' && d.type !== decisionTypeFilter) return false
      return true
    })
    const drafts = filteredDecisions.filter((d: any) => d.stage === 'Draft')
    const finals = filteredDecisions.filter((d: any) => d.stage === 'Final')
    const releasable = finals.filter((d: any) => boundTypes.has(d.type))
    const skipped = finals.length - releasable.length
    const releaseAll = async () => {
      if (releasingAll) return
      const ids = releasable.map((d: any) => d.id)
      if (ids.length === 0) return
      if (
        !(await dialog.confirm({
          title: `Release ${ids.length} decision${ids.length === 1 ? '' : 's'}?`,
          description:
            `This emails ${ids.length === 1 ? 'this applicant' : `all ${ids.length} applicants`} their decision right now. It can't be undone.`,
          confirmLabel: `Release ${ids.length}`,
          tone: "destructive",
        }))
      )
        return
      setReleasingAll(true)
      for (const id of ids) {
        await fetch(`/api/hiring/decisions/${id}/release`, { method: 'POST', credentials: 'include' })
      }
      const releasedIds = new Set(ids)
      setPendingDecisions(prev => prev.filter(p => !releasedIds.has(p.id)))
      setReleasingAll(false)
    }
    const rowActions = (d: any) => {
      if (d.stage === 'Draft') {
        return (
          <button
            type="button"
            onClick={() => finalizeDecisions([d.id])}
            disabled={finalizing}
            className={buttonClasses('secondary', 'sm')}
          >
            Finalize
          </button>
        )
      }
      const hasBinding = boundTypes.has(d.type)
      return (
        <>
          <Tooltip content="Preview email">
            <button
              type="button"
              onClick={() => setPreviewDecisionId(d.id)}
              className="os-icon-btn"
              aria-label="Preview email"
            >
              <Eye className="h-4 w-4" />
            </button>
          </Tooltip>
          <Tooltip content={!hasBinding ? `Write this decision's email on Setup first.` : null} variant="rich">
            <span>
              <button
                type="button"
                onClick={() => confirmReleaseOne(d)}
                disabled={releasing === d.id || releasingAll || !hasBinding}
                className={buttonClasses('primary', 'sm')}
              >
                {releasing === d.id ? 'Releasing…' : 'Release'}
              </button>
            </span>
          </Tooltip>
        </>
      )
    }
    const typeTone = (type: string) =>
      type === 'Accepted' ? 'success' : type === 'Waitlisted' ? 'warning' : type === 'Rejected' ? 'neutral' : 'accent'
    const showDomainFilter = availableDomains.length > 1
    const showTypeFilter = availableTypes.length > 1
    return (
    <>
      <SetupCard
        title={DECISION_SLICES[kind].title}
        description={
          scoped.length === 0
            ? DECISION_SLICES[kind].empty
            : filtersActive
              ? `Showing ${filteredDecisions.length} of ${scoped.length}.`
              : `${scoped.length} waiting.`
        }
        action={
          <>
            {drafts.length > 0 && (
              <button
                type="button"
                onClick={() => finalizeDecisions(drafts.map((d: any) => d.id))}
                disabled={finalizing}
                className={buttonClasses('secondary', 'md')}
              >
                {finalizing ? 'Finalizing…' : `Finalize all (${drafts.length})`}
              </button>
            )}
            {finals.length > 0 && (
              <Tooltip content={skipped > 0 ? `${skipped} skipped, no email written` : null}>
                <span>
                  <button
                    type="button"
                    onClick={releaseAll}
                    disabled={releasable.length === 0 || releasingAll}
                    className={buttonClasses('primary', 'md')}
                  >
                    {releasingAll ? 'Releasing…' : `Release ${filtersActive ? 'shown' : 'all'} (${releasable.length})`}
                  </button>
                </span>
              </Tooltip>
            )}
          </>
        }
      >
        {(showDomainFilter || showTypeFilter) && (
          <div className="flex flex-wrap items-center gap-2">
            {showDomainFilter &&
              <FilterSelect label="Domain" value={decisionDomainFilter} onChange={setDecisionDomainFilter} allLabel="All domains" values={availableDomains} />}
            {showTypeFilter &&
              <FilterSelect label="Decision" value={decisionTypeFilter} onChange={setDecisionTypeFilter} allLabel="All decisions" values={availableTypes} />}
            {filtersActive && (
              <button
                type="button"
                onClick={() => { setDecisionDomainFilter('all'); setDecisionTypeFilter('all') }}
                className={buttonClasses('ghost', 'sm')}
              >
                Clear
              </button>
            )}
          </div>
        )}
        {scoped.length > 0 && (
          <div className="flex flex-col gap-2">
            {filteredDecisions.map((d: any) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {d.domainApplication.application.user.firstName} {d.domainApplication.application.user.lastName}
                  </span>
                  <span className="text-sm text-os-grey">
                    {[domainNameOf(d), `by ${d.madeBy.firstName} ${d.madeBy.lastName}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {kind !== 'invites' && <Pill dot={typeTone(d.type)}>{d.type}</Pill>}
                  {d.stage === 'Draft' && <Pill>Draft</Pill>}
                  {rowActions(d)}
                </div>
              </div>
            ))}
            {filteredDecisions.length === 0 && (
              <p className={cn(os.bodyText, 'py-3 text-center')}>No decisions match these filters.</p>
            )}
          </div>
        )}
      </SetupCard>
      {previewDecisionId && (() => {
        const d = scoped.find((x: any) => x.id === previewDecisionId)
        if (!d) return null
        return (
          <DecisionEmailPreviewModal
            decision={d}
            email={loaderData?.hiringEmails?.[decisionSlot(d.type as DecisionSlotType)] ?? null}
            onClose={() => setPreviewDecisionId(null)}
          />
        )
      })()}
    </>
    )
  }

  // Free time comes from each interviewer's DALI OS calendar, read inside the
  // interview window; there's nothing to read until that window is set.
  const interviewWindowSet = !!config.interviewStartDate && !!config.interviewEndDate
  function availabilityCell(i: any) {
    if (!interviewWindowSet) return <span className="text-muted-foreground">Set the interview window</span>
    const hours = i.availabilityHours ?? 0
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        {hours > 0 ? (
          <span className="text-sm text-os-grey">{hours.toFixed(1)}h free</span>
        ) : (
          <Pill tone="warning">No free time</Pill>
        )}
        {!i.hasCalendar && <Pill tone="warning">No calendar</Pill>}
      </span>
    )
  }

  // Roster pickers: the cycle's own domains, and current lab members by name.
  const rosterDomains = (cycle?.domains ?? []).map((d: any) => ({
    id: d.domainId,
    name: d.domain?.name ?? d.domain?.displayName ?? d.domainId,
  }))
  const personName = (u: any, fallback: string) =>
    (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}` : u?.daliEmail) ?? fallback
  const memberOptions = allMembers.map((m) => ({ id: m.id, name: personName(m, m.daliEmail) }))

  const delibRows = (roundId: string) =>
    (cycle?.domains ?? []).map((d: any) => {
      const state = loaderData?.phaseStatusByDomain?.[d.domainId]?.rounds?.[roundId] ?? 'none'
      return {
        domainId: d.domainId,
        name: d.domain?.name ?? d.domain?.displayName ?? d.domainId,
        done: state === 'closed',
        detail: state === 'closed' ? 'Closed' : state === 'active' ? 'In progress' : 'Not started',
      }
    })

  // Opening is still a status change; the header's action runs the next one.
  const draftChecklistMet = cycleStatus !== 'Draft' || (() => {
    const domains = cycle?.domains ?? []
    const allDomainsReady = domains.length > 0 && domains.every((d: any) => d.isReady)
    // Without challenges the application form is all there is to fill.
    const needsForm = isMemberCycle || !cycle?.hasChallenges
    return !!cycle?.closeDate && allDomainsReady && (!needsForm || !!cycle?.applicationForm)
  })()
  const statusIdx = STATUS_FLOW.indexOf(cycleStatus as any)
  const atTerminal = statusIdx < 0 || statusIdx >= STATUS_FLOW.length - 1
  async function runNextStatus() {
    if (cycleStatus === 'UnderReview') return setShowCompleteConfirm(true)
    if (cycleStatus === 'Draft') return setShowOpenConfirm(true)
    if (
      !(await dialog.confirm({
        title: 'Close applications?',
        description:
          "This stops accepting new applications and moves the cycle to Under Review. Applicants who haven't submitted won't be able to submit.",
        confirmLabel: 'Close applications',
        tone: 'destructive',
      }))
    )
      return
    advanceStatus()
  }
  const nextStatusLabel =
    cycleStatus === 'Draft' ? 'Open applications' : cycleStatus === 'Open' ? 'Close applications' : 'Complete cycle'
  const statusAction = !atTerminal && (
    <Tooltip
      content={!draftChecklistMet ? 'Set the close date, get every domain ready, and add the application form first.' : null}
      variant="rich"
    >
      <span>
        <button
          type="button"
          onClick={runNextStatus}
          disabled={statusUpdating || !draftChecklistMet}
          className={buttonClasses('primary', 'md')}
        >
          {statusUpdating ? 'Updating…' : nextStatusLabel}
          <ArrowRight className="w-4 h-4" aria-hidden />
        </button>
      </span>
    </Tooltip>
  )
  const phaseIcon = { done: CheckCircle2, current: CircleDot, overdue: AlertCircle, upcoming: undefined } as const

  const page = (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className={os.pageTitle}>{cycle?.name ?? 'Cycle'}</h1>
        <Pill dot={STATUS_TONES[cycleStatus] ?? 'neutral'}>{STATUS_LABELS[cycleStatus] ?? cycleStatus}</Pill>
        <div className="ml-auto flex items-center gap-3">
          <PresenceBar />
          {statusAction}
        </div>
      </header>

      <CloseDateNotice />

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

      <SegmentedTabButtons
        label="Phases"
        items={phaseTabs.map(p => ({
          label: p.label,
          icon: phaseIcon[p.status],
          active: p.key === tab,
          onClick: () => setTab(p.key),
        }))}
      />

      {/* Keyed by tab so each tab's nav lists only its own sections. */}
      <SectionNavLayout key={tab} label="Sections">

      {/* ── Setup Tab ── */}
      {tab === 'setup' && (
        <div className="flex flex-col gap-6">
          <NavSection id="term-dates" title="Term and dates">
          <TermDatesCard
            termId={cycle?.termId ?? null}
            termOptions={loaderData?.termOptions ?? []}
            openDate={cycle?.openDate ?? null}
            closeDate={cycle?.originalCloseDate ?? cycle?.closeDate ?? null}
            cycleStatus={cycleStatus}
          />
          </NavSection>

          <NavSection id="audience" title="Audience">
          <AudienceCard
            applicants={cycle.applicants}
            hasChallenges={cycle.hasChallenges}
            cycleStatus={cycleStatus}
            viewerIsAdmin={!!loaderData?.viewerIsAdmin}
          />
          </NavSection>

          {/* Extending the close only makes sense once a close date is set. */}
          {cycle?.closeDate && (
            <NavSection id="extension" title="Deadline extension">
            <CloseDateCard
              cycle={cycle}
              cycleStatus={cycleStatus}
            />
            </NavSection>
          )}

          <NavSection id="timeline" title="Timeline">
          <TimelineCard
            timeline={timeline}
            roundsWithBoards={loaderData?.roundsWithBoards ?? []}
            cycleStatus={cycleStatus}
            termStart={termStart}
            isDefault={JSON.stringify(timeline) === JSON.stringify(defaultTimelineFor(cycle.applicants))}
          />
          </NavSection>

          {/* Domains: Students cycles are set up per domain by domain leads;
              Interns cycles pick target domains here; Lab members cycles hang
              off the single CORE domain linked at creation. */}
          <NavSection id="domains" title={domainsTitle}>
          {cycle?.applicants === 'LabMembers' ? (
            <SetupCard
              title="Applicant pool"
              description="Open to all current lab members. Every application goes to Core."
            />
          ) : isMemberCycle ? (
            <TargetDomainsCard
              cycleDomains={cycle?.domains ?? []}
              eligibleDomains={memberSetup.eligibleDomains}
              challengeFor={challengeFor}
              cycleStatus={cycleStatus}
            />
          ) : (
            <SetupCard
              title="Domains"
            >
              {(cycle?.domains ?? []).length > 0 ? (
                <div className="flex flex-col gap-2">
                  {(cycle?.domains ?? []).map((d: any) => (
                    <DomainOverridePanel
                      key={d.domainId}
                      domain={d}
                      cycleStatus={cycleStatus}
                      showRubric={!!cycle?.hasChallenges}
                      challenge={challengeFor(d.domainId)}
                      rubricOptions={loaderData?.domainRubricVersions ?? []}
                      rubricLocked={(loaderData?.reviewedDomainIds ?? []).includes(d.domainId)}
                    />
                  ))}
                </div>
              ) : (
                <p className={cn(os.bodyText, 'py-4 text-center')}>No domains added yet.</p>
              )}
              {cycleStatus === 'Draft' && (
                <Form method="post" preventScrollReset className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="intent" value="add-domain" />
                  <div className={cn(os.fieldLabel, 'min-w-[14rem] flex-1')}>
                    Add domain
                    <Select
                      name="domainId"
                      defaultValue=""
                      placeholder="Pick a domain"
                      options={(loaderData?.allDomains ?? [])
                        .filter((d: any) => !(cycle?.domains ?? []).some((cd: any) => cd.domainId === d.id))
                        .map((d: any): SelectOption => ({ value: d.id, label: d.name }))}
                      buttonClassName={rowTrigger(os.formTrigger)}
                    />
                  </div>
                  <button type="submit" className={buttonClasses('primary', 'md', 'h-9')}>
                    <Plus className="w-4 h-4" aria-hidden /> Add
                  </button>
                </Form>
              )}
            </SetupCard>
          )}
          </NavSection>

          <NavSection id="general-application" title="General application">
            <GeneralApplicationSection
              cycleStatus={cycleStatus}
              applicationForm={cycle?.applicationForm ?? null}
              allForms={loaderData?.allForms ?? []}
              currentRubricVersionId={cycle?.generalRubricVersionId}
              rubricVersionOptions={loaderData?.rubricVersionOptions ?? []}
              rubricLocked={(loaderData?.cycleApplicationReviewCount ?? 0) > 0}
            />
          </NavSection>





          {/* Blind review */}
          <NavSection id="blind-review" title="Blind review">
          <BlindReviewToggle anonymizeReview={cycle?.anonymizeReview ?? true} />
          </NavSection>

          {/* Confidentiality Agreement */}
          <NavSection id="confidentiality" title="Confidentiality agreement">
          <ConfidentialityAgreementPicker
            currentBinding={loaderData?.currentConfidentialityBinding ?? null}
            agreementOptions={loaderData?.confidentialityAgreementOptions ?? []}
            signatures={loaderData?.confidentialitySignatures ?? []}
          />
          </NavSection>

          {/* Decision-release email bindings */}
          <NavSection id="decision-emails" title="Decision emails">
          <DecisionEmailsSection
            hiringEmails={loaderData?.hiringEmails ?? {}}
            hasInterviews={hasInterviews}
          />
          </NavSection>

          {/* Non-decision notification email bindings. Application slots fire
              from the student portal; interview slots only with interviews. */}
          {(!isMemberCycle || hasInterviews) && (
            <NavSection id="notification-emails" title="Notification emails">
            <NotificationEmailsSection
              hiringEmails={loaderData?.hiringEmails ?? {}}
              slots={NOTIFICATION_EMAIL_SLOTS.filter((slot) =>
                slot.type.startsWith('Interview') ? hasInterviews : !isMemberCycle,
              )}
            />
            </NavSection>
          )}
        </div>
      )}


      {/* ── Interviews Tab — schedule, then coverage, then roster, then config ── */}
      {tab === 'interviews' && (
      <NavSection id="schedule" title="Schedule">
      {tab === 'interviews' && loaderData?.confidentialityRequired ? (
        <ConfidentialityGate
          cycleId={cycleId ?? ''}
          reason={loaderData.confidentialityRequired}
          next={`/hiring/lead/cycle/${cycleId}?tab=interviews`}
        />
      ) : tab === 'interviews' && (() => {
        // Filter inputs derived from current data so empty options never show.
        const domainFor = (p: PendingInviteRow) => p.domainApplication.domain.name
        const isCancelled = (status: string) =>
          status === 'CancelledByApplicant' || status === 'CancelledByAdmin'
        // Hide cancelled interviews unless the user opted in. A cancelled-only
        // applicant still surfaces via the pending list ("Awaiting Schedule"),
        // so the dashboard keeps 1 row per applicant.
        const visibleInterviews = showCancelledInterviews
          ? interviews
          : interviews.filter(i => !isCancelled(i.status))
        const hiddenCancelledCount = interviews.length - visibleInterviews.length
        const availableDomains = Array.from(new Set<string>([
          ...visibleInterviews.map(i => i.domainApplication.domain.name).filter(Boolean),
          ...pendingInvites.map(domainFor).filter(Boolean),
        ])).sort()
        const availableStatuses = Array.from(new Set<string>([
          ...(pendingInvites.length > 0 ? ['Awaiting schedule'] : []),
          ...visibleInterviews.map(i => i.status),
        ]))
        const filtersActive = interviewDomainFilter !== 'all' || interviewStatusFilter !== 'all'
        const filteredInterviews = visibleInterviews.filter(i => {
          if (interviewDomainFilter !== 'all' && i.domainApplication.domain.name !== interviewDomainFilter) return false
          if (interviewStatusFilter !== 'all' && i.status !== interviewStatusFilter) return false
          return true
        })
        const filteredPending = pendingInvites.filter(p => {
          if (interviewDomainFilter !== 'all' && domainFor(p) !== interviewDomainFilter) return false
          if (interviewStatusFilter !== 'all' && interviewStatusFilter !== 'Awaiting schedule') return false
          return true
        })
        const totalRows = filteredInterviews.length + filteredPending.length
        const totalAll = visibleInterviews.length + pendingInvites.length
        // Show the filter bar whenever there's any data — including cancelled
        // interviews that are currently hidden — so the toggle stays reachable.
        const hasAnyRows = interviews.length + pendingInvites.length > 0
        const tableEmpty = totalRows === 0
        // "Resend invite" needs the InterviewInviteReminder email written.
        // Without it there's nothing to send, so the button is disabled with a
        // tooltip pointing at Setup.
        const reminderTemplateBound = !!loaderData?.hiringEmails?.['notification:InterviewInviteReminder']
        async function resendInvite(daId: string, firstName?: string) {
          if (
            !(await dialog.confirm({
              title: `Resend interview invite to ${firstName ?? 'this applicant'}?`,
              description: 'Re-emails the applicant the scheduling link using the invite reminder email.',
              confirmLabel: 'Resend',
              tone: 'destructive',
            }))
          )
            return
          setResendingInviteId(daId)
          try {
            const res = await fetch(`/api/hiring/domain-applications/${daId}/resend-invite`, {
              method: 'POST',
              credentials: 'include',
            })
            if (!res.ok) {
              const body = await res.json().catch(() => ({}))
              toast.error(body.error ?? 'Failed to resend invite')
            }
          } finally {
            setResendingInviteId(null)
          }
        }
        const locationLabel = (loc: string) =>
          loc === 'PodAppa' ? 'Pod Appa' : loc === 'PodMomo' ? 'Pod Momo' : 'Online'
        async function changeLocation(interview: any, newLocation: string) {
          if (
            !(await dialog.confirm({
              title: 'Change interview location?',
              description: 'Emails the applicant and both interviewers a location-change notice.',
              confirmLabel: 'Change Location',
              tone: 'destructive',
            }))
          )
            return
          const res = await fetch(`/api/hiring/interviews/${interview.id}/location`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location: newLocation }),
          })
          if (res.ok) {
            const updated = await res.json()
            setInterviews(prev => prev.map(i =>
              i.id === interview.id ? { ...i, location: newLocation, zoomJoinUrl: updated.zoomJoinUrl ?? null, videoUrl: updated.videoUrl ?? null } : i
            ))
          } else {
            const body = await res.json().catch(() => ({}))
            toast.error(body.error ?? 'Failed to update location')
          }
        }
        async function reassign(interview: any, a: any, value: string) {
          if (!value) return
          if (
            !(await dialog.confirm({
              title: 'Reassign interviewer?',
              description: `Emails the removed interviewer and the replacement interviewer about the change.`,
              confirmLabel: 'Reassign',
              tone: 'destructive',
            }))
          )
            return
          await fetch(`/api/hiring/interviews/${interview.id}/reassign`, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId: a.id, newCycleInterviewerId: value }),
          })
          window.location.reload()
        }
        const applicantLink = (daId: string, u: { firstName?: string | null; lastName?: string | null }) => (
          <Link
            to={`/hiring/applications/${daId}`}
            onClick={(e) => {
              const url = `/hiring/applications/${daId}`
              const label = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Applicant'
              if (requestOpenTabIfEmbedded(url, label)) e.preventDefault()
            }}
            className="truncate text-sm font-semibold text-foreground hover:underline"
          >
            {u.firstName} {u.lastName}
          </Link>
        )
        const statusTone = (status: string) =>
          status === 'Scheduled' ? 'success' : status === 'Completed' ? 'accent' : 'neutral'
        const smallTrigger = cn(rowTrigger(os.formTrigger), 'h-8 w-auto text-xs')
        const showDomainFilter = availableDomains.length > 1
        const showStatusFilter = availableStatuses.length > 1
        return (
        <div className="flex flex-col gap-6">
          <SetupCard
            title="Schedule"
            description={
              totalAll === 0
                ? 'No interviews scheduled yet.'
                : filtersActive
                  ? `Showing ${totalRows} of ${totalAll}.`
                  : `${totalAll} applicant${totalAll === 1 ? '' : 's'}.`
            }
          >
            {hasAnyRows && (
              <div className="flex flex-wrap items-center gap-3">
                {showDomainFilter && (
                  <FilterSelect label="Domain" value={interviewDomainFilter} onChange={setInterviewDomainFilter} allLabel="All domains" values={availableDomains} />
                )}
                {showStatusFilter && (
                  <FilterSelect label="Status" value={interviewStatusFilter} onChange={setInterviewStatusFilter} allLabel="All statuses" values={availableStatuses} />
                )}
                {filtersActive && (
                  <button
                    type="button"
                    onClick={() => { setInterviewDomainFilter('all'); setInterviewStatusFilter('all') }}
                    className={buttonClasses('ghost', 'sm')}
                  >
                    Clear
                  </button>
                )}
                <Checkbox
                  checked={showCancelledInterviews}
                  onChange={(e) => setShowCancelledInterviews(e.target.checked)}
                  label={`Show cancelled${hiddenCancelledCount > 0 && !showCancelledInterviews ? ` (${hiddenCancelledCount})` : ''}`}
                  className="text-sm text-os-grey select-none"
                />
              </div>
            )}
            {hasAnyRows && (
              <div className="flex flex-col gap-2">
                {filteredPending.map(p => {
                  const u = p.domainApplication.application.user
                  const invited = new Date(p.invitedAt)
                  return (
                    <div key={`pending-${p.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        {applicantLink(p.domainApplication.id, u)}
                        <span className="text-sm text-os-grey">
                          {[domainFor(p), `Invited ${invited.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill dot="warning">Awaiting schedule</Pill>
                        <Tooltip content={!reminderTemplateBound ? 'Write the invite reminder email on Setup to resend invites.' : null} variant="rich">
                          <span>
                            <button
                              type="button"
                              onClick={() => resendInvite(p.domainApplication.id, u.firstName ?? undefined)}
                              disabled={!reminderTemplateBound || resendingInviteId === p.domainApplication.id}
                              className={buttonClasses('secondary', 'sm')}
                            >
                              {resendingInviteId === p.domainApplication.id ? 'Sending…' : 'Resend invite'}
                            </button>
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                  )
                })}
                {filteredInterviews.map(interview => {
                  const editable = new Date(interview.startTime) > new Date() && interview.status === 'Scheduled'
                  const domainName = interview.domainApplication.domain.name
                  const start = new Date(interview.startTime)
                  const end = new Date(interview.endTime)
                  const when = `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} to ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
                  const meetUrl = interview.location === 'Online' ? (interview.videoUrl ?? interview.zoomJoinUrl) : null
                  return (
                    <div key={interview.id} className="flex flex-col gap-3 rounded-os-item bg-os-well px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          {applicantLink(interview.domainApplication.id, interview.domainApplication.application.user)}
                          <span className="text-sm text-os-grey">{[domainName, when].filter(Boolean).join(' · ')}</span>
                        </div>
                        <Pill dot={statusTone(interview.status)}>{interview.status}</Pill>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                        <span className="inline-flex items-center gap-2">
                          <span className="text-os-grey">Location</span>
                          {editable ? (
                            <>
                              <Select
                                ariaLabel="Location"
                                value={interview.location}
                                onChange={(value) => changeLocation(interview, value)}
                                options={[
                                  { value: "PodAppa", label: "Pod Appa" },
                                  { value: "PodMomo", label: "Pod Momo" },
                                  { value: "Online", label: "Online" },
                                ]}
                                buttonClassName={smallTrigger}
                              />
                              <EmailMarker recipients="applicant + both interviewers" label="Changing fires location-change email" />
                            </>
                          ) : (
                            <span className="text-foreground">{locationLabel(interview.location)}</span>
                          )}
                          {meetUrl && (
                            <a href={meetUrl} target="_blank" rel="noopener noreferrer" className="text-os-accent hover:underline">
                              Join Google Meet
                            </a>
                          )}
                        </span>
                        {interview.assignments
                          .filter((a: any) => a.status === 'Active')
                          .map((a: any) => {
                            const m = a.cycleInterviewer.user
                            const name = m.firstName && m.lastName
                              ? `${m.firstName} ${m.lastName}`
                              : m.daliEmail ?? '?'
                            const roleLabel = a.role === 'InDomain' ? a.cycleInterviewer.domain.name : 'Cross'
                            return (
                              <span key={a.id} className="inline-flex items-center gap-2">
                                <span className="text-foreground">{name}</span>
                                <span className="text-os-grey">{roleLabel}</span>
                                {editable && (
                                  <>
                                    <Select
                                      value=""
                                      onChange={(value) => reassign(interview, a, value)}
                                      placeholder="Reassign"
                                      ariaLabel={`Reassign ${a.role === 'InDomain' ? 'in-domain' : 'cross-domain'} interviewer`}
                                      options={interviewers
                                        .filter((i: any) => a.role === 'InDomain'
                                          ? i.domain?.name === a.cycleInterviewer.domain.name
                                          : i.domain?.name !== domainName)
                                        .filter((i: any) => i.id !== a.cycleInterviewerId)
                                        .map((i: any): SelectOption => {
                                          const im = i.user
                                          const iName = im?.firstName && im?.lastName ? `${im.firstName} ${im.lastName}` : im?.daliEmail ?? i.id
                                          return { value: i.id, label: iName }
                                        })}
                                      buttonClassName={smallTrigger}
                                    />
                                    <EmailMarker recipients="removed + replacement interviewer" label="Reassigning fires emails" />
                                  </>
                                )}
                              </span>
                            )
                          })}
                      </div>
                    </div>
                  )
                })}
                {tableEmpty && (
                  <p className={cn(os.bodyText, 'py-3 text-center')}>
                    {totalAll === 0 ? 'No interviews scheduled yet.' : 'No interviews match these filters.'}
                  </p>
                )}
              </div>
            )}
          </SetupCard>
          {/* Per-domain availability summary: who has interviewers and how
              many hours each domain has offered. Computed client-side from
              the already-loaded interviewers list. */}
          {interviewers.length > 0 && (() => {
            const byDomain = new Map<string, { count: number; hours: number; submitted: number }>()
            for (const i of interviewers as any[]) {
              const name: string = i.domain?.name ?? '—'
              const entry = byDomain.get(name) ?? { count: 0, hours: 0, submitted: 0 }
              entry.count += 1
              entry.hours += (i.availabilityHours ?? 0)
              if ((i.availabilityBlockCount ?? 0) > 0) entry.submitted += 1
              byDomain.set(name, entry)
            }
            const rows = Array.from(byDomain.entries()).sort(([a], [b]) => a.localeCompare(b))
            return (
              <SetupCard title="Coverage by domain" description="Interviewers and free hours per domain.">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {rows.map(([name, e]) => (
                    <div key={name} className="flex flex-col gap-0.5 rounded-os-item bg-os-well px-4 py-3">
                      <span className="text-sm font-semibold text-foreground">{name}</span>
                      <span className="text-sm text-os-grey">
                        {e.count} interviewer{e.count === 1 ? '' : 's'} · {e.hours.toFixed(0)}h free
                      </span>
                      {e.submitted < e.count && (
                        <span className="text-sm text-amber-700">{e.count - e.submitted} with no free time</span>
                      )}
                    </div>
                  ))}
                </div>
              </SetupCard>
            )
          })()}
          <CoverageHeatmap coverage={coverage} />
        </div>
        )
      })()}
      </NavSection>
      )}


      {/* ── Review: progress, delibs round, interview schedule, invites ── */}
      {/* ── Review: the review team, then review progress ── */}
      {tab === 'review' && isMemberCycle && (
        <NavSection id="reviewers" title="Reviewer pool">
        <ReviewerPoolCard
          reviewers={memberSetup.reviewerPool}
          members={memberSetup.members}
          hasDomains={(cycle?.domains ?? []).length > 0}
          canResetToDefault={cycle?.applicants === 'LabMembers'}
        />
        </NavSection>
      )}
      {tab === 'review' && !isMemberCycle && (
        <NavSection id="reviewers" title="Reviewers">
          <DomainRosterCard
            title="Reviewers"
            description="Who reads each domain's applications."
            role="reviewer"
            mentors
            domains={rosterDomains}
            members={memberOptions}
            people={reviewers.map((r: any) => ({
              id: r.id,
              userId: r.userId ?? r.user?.id,
              domainId: r.domainId ?? r.domain?.id,
              name: personName(r.user, 'Reviewer'),
            }))}
            onAdd={addReviewer}
            onRemove={(p) => removeReviewer(p.id)}
          />
        </NavSection>
      )}
      {tab === 'review' && hasInterviews && (
        <NavSection id="interviewers" title="Interviewers">
          <DomainRosterCard
            title="Interviewers"
            description={
              interviewWindowSet
                ? `${interviewers.filter((i: any) => (i.availabilityHours ?? 0) > 0).length} of ${interviewers.length} have free time on their calendar.`
                : 'Free time shows once the interview window is set.'
            }
            role="interviewer"
            mentors={!isMemberCycle}
            domains={rosterDomains}
            members={memberOptions}
            people={(interviewers as any[]).map((i: any) => ({
              id: i.id,
              userId: i.userId,
              domainId: i.domainId ?? i.domain?.id,
              name: personName(i.user, 'Interviewer'),
              detail: availabilityCell(i),
            }))}
            onAdd={addInterviewer}
            onRemove={(p) => removeInterviewer(p.id)}
          />
        </NavSection>
      )}
      {tab === 'review' && (
        <NavSection id="review-progress" title="Review progress">
        <DomainStatusList
          title="Review progress"
          rows={(cycle?.domains ?? []).map((d: any) => {
            const r = loaderData?.phaseStatusByDomain?.[d.domainId]?.reviews ?? { assigned: 0, submitted: 0 }
            return {
              domainId: d.domainId,
              name: d.domain?.name ?? d.domainId,
              done: r.assigned > 0 && r.submitted === r.assigned,
              detail: r.assigned === 0 ? 'No reviews assigned' : `${r.submitted} of ${r.assigned} submitted`,
            }
          })}
        />
        </NavSection>
      )}
      {tab === 'interviews' && (
        <NavSection id="interview-config" title="Interview schedule">
        <SetupCard title="Interview schedule" description="When applicants can book and how much notice they need.">
          <div className={cn(os.formClass, 'grid grid-cols-1 gap-4 md:grid-cols-2')}>
            <label className={os.fieldLabel}>
              Slot length
              <Select
                ariaLabel="Slot length"
                value={String(config.slotDurationMinutes)}
                onChange={(value) => setConfig(c => ({ ...c, slotDurationMinutes: Number(value) }))}
                options={DURATION_OPTIONS.map((d): SelectOption => ({ value: String(d), label: `${d} minutes` }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </label>
            <label className={os.fieldLabel}>
              Buffer between interviews
              <Select
                ariaLabel="Buffer between interviews"
                value={String(config.bufferMinutes)}
                onChange={(value) => setConfig(c => ({ ...c, bufferMinutes: Number(value) }))}
                options={BUFFER_OPTIONS.map((b): SelectOption => ({ value: String(b), label: `${b} minutes` }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </label>
            <label className={os.fieldLabel}>
              Day start
              <Select
                ariaLabel="Day start"
                value={String(config.dayStartHour)}
                onChange={(value) => setConfig(c => ({ ...c, dayStartHour: Number(value) }))}
                options={HOUR_OPTIONS.map((h): SelectOption => ({ value: String(h), label: formatHour(h) }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </label>
            <label className={os.fieldLabel}>
              Day end
              <Select
                ariaLabel="Day end"
                value={String(config.dayEndHour)}
                onChange={(value) => setConfig(c => ({ ...c, dayEndHour: Number(value) }))}
                options={HOUR_OPTIONS.map((h): SelectOption => ({ value: String(h), label: formatHour(h) }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </label>
            <div className={os.fieldLabel}>
              Interview start date
              <DateField
                mode="date"
                value={config.interviewStartDate}
                onChange={(value) => setConfig(c => ({ ...c, interviewStartDate: value }))}
                className="w-full"
                buttonClassName={rowTrigger(os.formTrigger)}
                ariaLabel="Interview start date"
              />
            </div>
            <div className={os.fieldLabel}>
              Interview end date
              <DateField
                mode="date"
                value={config.interviewEndDate}
                onChange={(value) => setConfig(c => ({ ...c, interviewEndDate: value }))}
                className="w-full"
                buttonClassName={rowTrigger(os.formTrigger)}
                ariaLabel="Interview end date"
              />
            </div>
            <label className={os.fieldLabel}>
              Booking notice
              <Select
                ariaLabel="Booking notice"
                value={String(config.bookingNoticeHours)}
                onChange={(value) => setConfig(c => ({ ...c, bookingNoticeHours: Number(value) }))}
                options={[0, 1, 2, 4, 6, 8, 12, 24, 48].map((h): SelectOption => ({ value: String(h), label: h === 0 ? 'No minimum' : `${h} hours ahead` }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </label>
            <label className={os.fieldLabel}>
              Reschedule notice
              <Select
                ariaLabel="Reschedule notice"
                value={String(config.rescheduleNoticeHours)}
                onChange={(value) => setConfig(c => ({ ...c, rescheduleNoticeHours: Number(value) }))}
                options={[0, 2, 4, 6, 8, 12, 24, 48].map((h): SelectOption => ({ value: String(h), label: h === 0 ? 'No minimum' : `${h} hours before` }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </label>
            <label className={os.fieldLabel}>
              Cancel notice
              <Select
                ariaLabel="Cancel notice"
                value={String(config.cancelNoticeHours)}
                onChange={(value) => setConfig(c => ({ ...c, cancelNoticeHours: Number(value) }))}
                options={[0, 2, 4, 6, 8, 12, 24, 48].map((h): SelectOption => ({ value: String(h), label: h === 0 ? 'Up until start' : `${h} hours before` }))}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </label>
          </div>
          <div>
            <button
              type="button"
              onClick={saveConfig}
              disabled={configSaving || !config.interviewStartDate || !config.interviewEndDate}
              className={buttonClasses('primary', 'md')}
            >
              {configSaving ? 'Saving…' : configSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </SetupCard>
        </NavSection>
      )}

      {/* ── A delib round: its boards, then what it hands on ── */}
      {activeRound && (
        <NavSection id="round-boards" title={activeRound?.label ?? 'Boards'}>
        <DomainStatusList
          title={activeRound.label}
          description={
            isMemberCycle && activeRound.isFinal
              ? undefined
              : 'Domain leads run delibs from their domain page.'
          }
          rows={delibRows(activeRound.id)}
        />
        </NavSection>
      )}
      {activeRound?.leadsToInterviews && (
        <NavSection id="invites" title="Interview invites">{renderDecisions('invites')}</NavSection>
      )}
      {activeRound?.isFinal && isMemberCycle && (
        <NavSection id="finalize" title="Draft decisions">{renderDecisions('finalize')}</NavSection>
      )}

      {/* ── Decisions ── */}
      {/* Drafts first: they are the ones still needing a lead's hand. Skipped
          when the round context above is already showing this same list, so a
          member cycle mid-final-round doesn't render it twice. */}
      {tab === 'decisions' && !(activeRound?.isFinal && isMemberCycle) && (
        <NavSection id="finalize" title="Draft decisions">{renderDecisions('finalize')}</NavSection>
      )}
      {tab === 'decisions' && (
        <NavSection id="release" title="Decisions to release">{renderDecisions('outcomes')}</NavSection>
      )}
      {tab === 'decisions' && cycleStatus === 'UnderReview' && (
        <NavSection id="complete" title="Complete the cycle">
        <section className={`${os.panel} ${os.panelPad} flex flex-wrap items-center justify-between gap-3`}>
          <div className="flex flex-col gap-1">
            <h3 className={os.sectionTitle}>Complete the cycle</h3>
            <p className={os.bodyText}>Once every decision is out, mark the cycle complete.</p>
          </div>
          <button type="button" onClick={() => setShowCompleteConfirm(true)} className={buttonClasses('primary', 'md')}>
            Complete cycle
          </button>
        </section>
        </NavSection>
      )}
      </SectionNavLayout>
    </div>
  )

  const collabToken = loaderData?.collabToken as string | null | undefined
  const currentUserId = loaderData?.currentUserId as string | undefined
  const presenceUserName = (loaderData?.presenceUserName as string | undefined) ?? ''
  const presencePhotoUrl = (loaderData?.presencePhotoUrl as string | null | undefined) ?? null
  const presenceSubtitle = (loaderData?.presenceSubtitle as string | null | undefined) ?? null
  return collabToken ? (
    <PresenceProvider
      pageId={`cycle:${cycleId}`}
      token={collabToken}
      userName={presenceUserName}
      userId={currentUserId}
      photoUrl={presencePhotoUrl}
      subtitle={presenceSubtitle}
    >
      {page}
    </PresenceProvider>
  ) : (
    page
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

function DecisionEmailPreviewModal({ decision, email, onClose }: {
  decision: any;
  /** The decision's shared email, or null when none is written. */
  email: { subject: string; body: string } | null;
  onClose: () => void;
}) {
  const firstName = decision.domainApplication.application.user.firstName ?? ''
  const domain =
    decision.domainApplication.domain?.name ??
    ''
  const tmpl = email
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
    <Modal
      open
      onClose={onClose}
      labelledBy="email-preview-title"
      containerClassName="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto my-auto"
    >
      <>
        <ModalHeader
          titleId="email-preview-title"
          title="Email preview"
          subtitle={
            <>
              {decision.domainApplication.application.user.firstName} {decision.domainApplication.application.user.lastName}
              {' · '}
              {domain}
              {' · '}
              <span className="font-medium">{decision.type}</span>
            </>
          }
          onClose={onClose}
          closeLabel="Close preview"
          className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border mb-0"
        />
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
                  className="mt-1 prose prose-sm dark:prose-invert max-w-none text-foreground"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{ __html: rendered?.html ?? '' }}
                />
              </div>
            </>
          ) : (
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-4 text-sm text-orange-800">
              <p className="font-medium">No email is written for {decision.type}.</p>
              <p className="mt-1">Releasing it sends nothing. Write one on Setup under Decision emails.</p>
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
      </>
    </Modal>
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
    <Modal
      open
      onClose={onClose}
      labelledBy="complete-confirm-title"
      disableEscape={submitting}
      containerClassName="bg-card rounded-lg shadow-xl w-full max-w-md p-6 space-y-4 my-auto"
    >
      <>
        {checking ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Checking cycle readiness...</p>
          </div>
        ) : hasBlockers ? (
          <>
            <h2 id="complete-confirm-title" className="text-lg font-semibold text-foreground">Cycle has unfinished work</h2>
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
      </>
    </Modal>
  );
}

function CloseDateNotice() {
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // Re-read on every navigation: an action's redirect lands on this same page
  // without remounting it.
  useEffect(() => {
    const url = new URL(window.location.href);
    const n = url.searchParams.get("notice");
    if (!n) return;
    setNotice(n);
    setAdded(url.searchParams.get("added"));
    url.searchParams.delete("notice");
    url.searchParams.delete("added");
    window.history.replaceState(window.history.state, "", url.toString());
  }, [location.search]);
  if (!notice) return null;
  const messages: Record<string, { text: string; tone: "ok" | "warn" }> = {
    "deadline-set": { text: "Close date saved.", tone: "ok" },
    "deadline-set-reopened": {
      text: "Close date saved and applications reopened — applicants can submit again until the new deadline.",
      tone: "warn",
    },
    "deadline-cleared": { text: "Close date cleared.", tone: "ok" },
    "open-date-set": { text: "Open date saved.", tone: "ok" },
    "applicants-changed": { text: "Applicants changed.", tone: "ok" },
    "timeline-saved": { text: "Timeline saved.", tone: "ok" },
    "mentors-added": { text: `Added ${added} mentor${added === "1" ? "" : "s"}.`, tone: "ok" },
    "mentors-already": { text: "Everyone's already on the roster.", tone: "ok" },
    "mentors-none": { text: "This domain has no mentors yet.", tone: "warn" },
    "timeline-reset": { text: "Timeline reset.", tone: "ok" },
    "term-dates-saved": { text: "Term and dates saved.", tone: "ok" },
    "open-date-cleared": { text: "Open date cleared.", tone: "ok" },
    "deadline-past": { text: "That date has passed. Pick a future date, or use Close applications at the top.", tone: "warn" },
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


// Extending the close date, and when applications actually stop. The close
// date itself is set on the Term and dates card; this card only renders once
// one exists.
function CloseDateCard({ cycle, cycleStatus }: { cycle: any; cycleStatus: string }) {
  const closeDate = new Date(cycle.closeDate);
  const originalCloseDate = cycle.originalCloseDate ? new Date(cycle.originalCloseDate) : null;
  const anchor = originalCloseDate ?? closeDate;
  const extensionMs = originalCloseDate ? closeDate.getTime() - originalCloseDate.getTime() : 0;
  const extensionActive = extensionMs > 0;

  return (
    <SetupCard
      title="Deadline extension"
      description="Adds time after the close date. Applicants see a deadline-extended notice."
      action={extensionActive ? <Pill tone="accent">Active</Pill> : null}
    >
      <ExtensionSection
        cycleId={cycle.id}
        anchor={anchor}
        extensionMs={extensionMs}
        extensionActive={extensionActive}
        cycleStatus={cycleStatus}
        extensionNoticeSentAt={cycle.extensionNoticeSentAt ? new Date(cycle.extensionNoticeSentAt) : null}
      />

      {/* Effective close (read-only) */}
      <div className="flex flex-col gap-1 rounded-os-item bg-os-well px-4 py-3">
        <span className="text-sm text-os-grey">Effective close</span>
        <span className="text-base font-semibold text-foreground">{formatCloseInstant(closeDate)}</span>
        <span className="text-xs text-os-grey">
          Applications stop and the cycle moves to Under Review.
          {extensionActive && originalCloseDate && <> Extended from {formatCloseInstant(originalCloseDate)}.</>}
        </span>
      </div>
    </SetupCard>
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
  const os = useOsChrome();

  return (
    <>
      <Form
        method="post"
        preventScrollReset
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          setShowConfirm(true);
        }}
        className={cn(os.formClass, "flex flex-wrap items-end gap-3")}
        aria-label={`Set deadline extension for cycle ${cycleId}`}
      >
        <input type="hidden" name="intent" value="extend-close-date" />
            <label className={cn(os.fieldLabel, "w-24")} htmlFor={`extend-amount-${cycleId}`}>
              Amount
              <input
                id={`extend-amount-${cycleId}`}
                type="number"
                name="amount"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="h-9 w-full"
              />
            </label>
            <div className={cn(os.fieldLabel, "w-28")}>
              Unit
              <Select
                name="unit"
                value={unit}
                onChange={(value) => setUnit(value as "hours" | "days")}
                options={[
                  { value: "hours", label: "hours" },
                  { value: "days", label: "days" },
                ]}
                buttonClassName={rowTrigger(os.formTrigger)}
              />
            </div>
          <button
            type="submit"
            disabled={!Number.isFinite(amount) || amount <= 0}
            className={buttonClasses("primary", "md", "h-9")}
          >
            {extensionActive ? "Update extension" : "Set extension"}
          </button>
      </Form>
      {extensionActive && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Form
            method="post"
            preventScrollReset
            aria-label="Resend deadline-extension email to draft applicants"
          >
            <input type="hidden" name="intent" value="resend-extension-notice" />
            <button type="submit" className={buttonClasses("secondary", "sm")}>
              {extensionNoticeSentAt ? "Resend extension notice" : "Send extension notice now"}
            </button>
          </Form>
          {extensionNoticeSentAt && (
            <span className="text-xs text-os-grey">
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
            <button type="submit" className={buttonClasses("ghost", "sm", "text-red-700")}>
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
                  The new effective close is still in the past, so applications stay closed.
                </div>
              )}
              <p>
                Applicants will see a &ldquo;Deadline extended&rdquo; notice on the portal between the original
                close and the new effective close.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowConfirm(false)} className={buttonClasses("secondary")}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  formRef.current?.submit();
                }}
                className={buttonClasses("primary")}
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

function BlindReviewToggle({ anonymizeReview }: { anonymizeReview: boolean }) {
  return (
    <SetupCard
      title="Blind review"
    >
      <Form method="post" preventScrollReset>
        <input type="hidden" name="intent" value="set-anonymize-review" />
        <Toggle
          name="anonymizeReview"
          tone="os"
          defaultChecked={anonymizeReview}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded-os-item bg-os-well px-4 py-3"
          label={anonymizeReview ? "On" : "Off"}
          description={anonymizeReview ? "Reviewers see “Applicant N”." : "Reviewers see real names."}
        />
      </Form>
    </SetupCard>
  );
}

// The general application: the form every applicant fills and the rubric
// every application is scored on, as two rows shaped like a domain row (label,
// what's bound, then small actions).
function GeneralApplicationSection({
  cycleStatus,
  applicationForm,
  allForms,
  currentRubricVersionId,
  rubricVersionOptions,
  rubricLocked,
}: {
  cycleStatus: string;
  applicationForm: { id: string; name: string } | null;
  allForms: { id: string; name: string }[];
  currentRubricVersionId: string | null;
  rubricVersionOptions: any[];
  rubricLocked: boolean;
}) {
  const os = useOsChrome();
  const formFetcher = useFetcher();
  const formBusy = formFetcher.state !== "idle";
  // The form can only be swapped while the cycle is in Draft.
  const formEditable = cycleStatus === "Draft";
  const [pickingForm, setPickingForm] = useState(false);
  // Opens on demand only: an auto-open editor under an empty value repeated
  // "Rubric" / "No rubric" twice.
  const [editingRubric, setEditingRubric] = useState(false);

  const versionLabel = (rv: any, fallback: string) =>
    formatVersionLabel({
      name: rv.rubric?.name ?? fallback,
      versionNumber: rv.versionNumber,
      createdAt: rv.createdAt,
      createdBy: rv.createdBy,
    });
  const currentRubric = rubricVersionOptions.find((rv: any) => rv.id === currentRubricVersionId);
  const currentRubricLabel = currentRubric ? versionLabel(currentRubric, "Rubric") : null;
  const small = buttonClasses("secondary", "sm");

  return (
    <SetupCard title="General application">
      {/* Same line anatomy as a domain's Challenge and Rubric lines. */}
      <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
        <DomainSubRow
          label="Form"
          value={
            applicationForm ? (
              <Link to={`/forms/edit/${applicationForm.id}`} className="min-w-0 max-w-full truncate text-os-accent hover:underline" title={applicationForm.name}>
                {applicationForm.name}
              </Link>
            ) : (
              <SubRowEmpty>None yet</SubRowEmpty>
            )
          }
          action={
            !pickingForm && (
              <>
                {!applicationForm && (
                  <button
                    type="button"
                    disabled={formBusy}
                    onClick={() => formFetcher.submit({ intent: "create-application-form" }, { method: "post" })}
                    className={small}
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden /> {formBusy ? "Creating…" : "Create form"}
                  </button>
                )}
                {formEditable && allForms.length > 0 && (
                  <button type="button" onClick={() => setPickingForm(true)} className={small}>
                    Use a different form
                  </button>
                )}
              </>
            )
          }
          editor={
            formEditable &&
            pickingForm && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[14rem] flex-1">
                  <Select
                    ariaLabel="Application form"
                    defaultValue={applicationForm?.id ?? ""}
                    placeholder="Pick a form"
                    onChange={(id) => {
                      setPickingForm(false);
                      if (!id || id === applicationForm?.id) return;
                      formFetcher.submit({ intent: "set-application-form", formId: id }, { method: "post" });
                    }}
                    options={allForms.map((f) => ({ value: f.id, label: f.name }))}
                    buttonClassName={rowTrigger(os.formTrigger)}
                  />
                </div>
                <button type="button" onClick={() => setPickingForm(false)} className={small}>
                  Cancel
                </button>
              </div>
            )
          }
        />
        <DomainSubRow
          label="Rubric"
          value={
            currentRubricLabel ? (
              <span className="min-w-0 max-w-full truncate" title={currentRubricLabel}>
                {currentRubricLabel}
              </span>
            ) : (
              <SubRowEmpty>None yet</SubRowEmpty>
            )
          }
          action={
            rubricLocked ? (
              <Pill>Locked, reviews started</Pill>
            ) : (
              !editingRubric && (
                <button type="button" onClick={() => setEditingRubric(true)} className={small}>
                  {currentRubric ? "Change" : "Set rubric"}
                </button>
              )
            )
          }
          editor={
            !rubricLocked &&
            editingRubric && (
              <Form
                method="post"
                preventScrollReset
                className="flex flex-wrap items-center gap-2"
                onSubmit={() => setEditingRubric(false)}
              >
                <input type="hidden" name="intent" value="set-general-rubric" />
                <div className="min-w-[14rem] flex-1">
                  <Select
                    name="rubricVersionId"
                    ariaLabel="General application rubric"
                    defaultValue={currentRubricVersionId ?? ""}
                    placeholder="Pick a rubric"
                    options={[
                      { value: "", label: "No rubric" },
                      ...rubricVersionOptions.map((rv: any): SelectOption => ({ value: rv.id, label: versionLabel(rv, "Rubric") })),
                    ]}
                    buttonClassName={rowTrigger(os.formTrigger)}
                  />
                </div>
                <button type="submit" className={buttonClasses("primary", "sm")}>
                  Save
                </button>
                <button type="button" onClick={() => setEditingRubric(false)} className={small}>
                  Cancel
                </button>
              </Form>
            )
          }
        />
      </div>
    </SetupCard>
  );
}

function DomainOverridePanel({
  domain,
  cycleStatus,
  showRubric,
  challenge,
  rubricOptions,
  rubricLocked,
}: {
  domain: any;
  cycleStatus: string;
  /** The per-domain rubric scores the challenge; hidden when there is none. */
  showRubric: boolean;
  /** This domain's challenges; null when the cycle has none. */
  challenge: DomainChallenge | null;
  rubricOptions: any[];
  rubricLocked: boolean;
}) {
  const [showReadyModal, setShowReadyModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRubricPreview, setShowRubricPreview] = useState(false);

  const readyLocked = cycleStatus !== 'Draft';
  const isReady: boolean = !!domain.isReady;

  // Close the ready modal when isReady flips — same-URL redirects don't remount
  // the component so the modal state survives the round-trip without this.
  useEffect(() => { setShowReadyModal(false); }, [isReady]);

  const [selectedRubricId, setSelectedRubricId] = useState(domain.rubricVersionId ?? '');
  // Like the Challenge line, the rubric shows what's set and opens a picker on demand.
  const [editingRubric, setEditingRubric] = useState(false);
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

  const os = useOsChrome();
  const domainName = domain.domain?.name ?? domain.domainId;
  const previewButton = (
    <Tooltip content="Preview">
      <button
        type="button"
        onClick={() => setShowRubricPreview(true)}
        aria-label="Preview"
        className={buttonClasses('secondary', 'sm', 'px-2')}
      >
        <Eye className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );

  return (
    <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!isReady && <NotReadyIcon />}
          <span className="text-sm font-semibold text-foreground">{domainName}</span>
        </div>
        <div className="flex items-center gap-1">
          {!readyLocked && (
            <button
              type="button"
              onClick={() => setShowReadyModal(true)}
              className={buttonClasses(isReady ? 'ghost' : 'secondary', 'sm')}
            >
              {isReady ? 'Unmark ready' : 'Force ready'}
            </button>
          )}
          {cycleStatus === 'Draft' && (
            <Tooltip content="Remove domain">
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className={os.iconBtn}
                aria-label={`Remove ${domainName}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {challenge && (
        <ChallengeLine domainId={domain.domainId} challenge={challenge} editable={cycleStatus === 'Draft'} />
      )}

      {showRubric && (
        <DomainSubRow
          label="Rubric"
          value={
            currentRubricLabel ? currentRubricLabel : <SubRowEmpty>None yet</SubRowEmpty>
          }
          action={
            <>
              {rubricLocked && <Pill>Locked, reviews assigned</Pill>}
              {currentRubric && !editingRubric && previewButton}
              {!rubricLocked && !editingRubric && rubricOptions.length > 0 && (
                <button type="button" onClick={() => setEditingRubric(true)} className={buttonClasses('secondary', 'sm')}>
                  {currentRubricLabel ? 'Change' : 'Set rubric'}
                </button>
              )}
            </>
          }
          editor={
            rubricOptions.length === 0 ? (
              <p className={os.bodyText}>No rubric versions yet. Create one in the Library.</p>
            ) : !rubricLocked && editingRubric ? (
              <Form
                method="post"
                preventScrollReset
                className="flex flex-wrap items-end gap-2"
                onSubmit={() => setEditingRubric(false)}
              >
                <input type="hidden" name="intent" value="hl-set-domain-rubric" />
                <input type="hidden" name="domainId" value={domain.domainId} />
                <div className="min-w-[14rem] flex-1">
                  <Select
                    name="rubricVersionId"
                    value={selectedRubricId}
                    onChange={(value) => setSelectedRubricId(value)}
                    placeholder="No rubric"
                    ariaLabel={`Select rubric version for ${domainName}`}
                    options={[
                      { value: "", label: "No rubric" },
                      ...rubricOptions.map((rv: any): SelectOption => ({
                        value: rv.id,
                        label: formatVersionLabel({
                          name: rv.rubric?.name ?? 'Rubric',
                          versionNumber: rv.versionNumber,
                          createdAt: rv.createdAt,
                          createdBy: rv.createdBy,
                        }),
                      })),
                    ]}
                    buttonClassName={rowTrigger(os.formTrigger)}
                  />
                </div>
                {selectedRubricId && previewButton}
                <button type="submit" className={buttonClasses('primary', 'md', 'h-9')}>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRubricId(domain.rubricVersionId ?? '');
                    setEditingRubric(false);
                  }}
                  className={buttonClasses('secondary', 'md', 'h-9')}
                >
                  Cancel
                </button>
              </Form>
            ) : null
          }
        />
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
          onClose={() => setShowReadyModal(false)}
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
  onClose,
}: {
  domain: any;
  isReady: boolean;
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

const DECISION_EMAIL_SLOTS: ReadonlyArray<{ type: DecisionSlotType; label: string; description: string }> = [
  { type: "Rejected", label: "Rejected", description: "Sent when a rejection is released." },
  { type: "InvitedToInterview", label: "Invited to interview", description: "Sent when an interview invite is released." },
  { type: "Waitlisted", label: "Waitlisted", description: "Sent when an applicant is waitlisted." },
  { type: "Accepted", label: "Accepted", description: "Sent when an offer is released." },
];

function DecisionEmailsSection({ hiringEmails, hasInterviews }: {
  hiringEmails: Record<string, { subject: string; body: string }>;
  hasInterviews: boolean;
}) {
  return (
    <SetupCard title="Decision emails" description="The email each released decision sends. Shared by every cycle.">
      <div className="flex flex-col gap-2">
        {DECISION_EMAIL_SLOTS.filter((slot) => hasInterviews || slot.type !== "InvitedToInterview").map((slot) => (
          <HiringEmailEditor
            key={slot.type}
            slot={slot}
            templateSlot={decisionSlot(slot.type)}
            email={hiringEmails[decisionSlot(slot.type)] ?? null}
          />
        ))}
      </div>
    </SetupCard>
  );
}

const NOTIFICATION_EMAIL_SLOTS: ReadonlyArray<{ type: NotificationSlotType; label: string; description: string }> = [
  { type: "ApplicationReceived", label: "Application received", description: "Sent when an applicant first submits." },
  { type: "ApplicationExtensionNotice", label: "Deadline extension notice", description: "Sent once to unsubmitted applicants after the original close." },
  { type: "InterviewInviteMentor", label: "Interview invite (interviewer)", description: "Sent when an interview is booked or reassigned." },
  { type: "InterviewInviteReminder", label: "Invite reminder (applicant)", description: "Sent by Resend invite when an applicant hasn't booked." },
  { type: "InterviewConfirmedApplicant", label: "Interview confirmed (applicant)", description: "Sent when the applicant books." },
  { type: "InterviewCancelledApplicant", label: "Interview cancelled (applicant)", description: "Sent when the interview is cancelled." },
  { type: "InterviewCancelledInterviewer", label: "Interview cancelled (interviewer)", description: "Sent when an interview is cancelled or reassigned away." },
  { type: "InterviewLocationChanged", label: "Interview location changed", description: "Sent to everyone when the location changes." },
  { type: "InterviewReminderApplicant", label: "Interview reminder (applicant)", description: "Sent 24 hours and 1 hour before the interview." },
  { type: "InterviewReminderInterviewer", label: "Interview reminder (interviewer)", description: "Sent 24 hours and 1 hour before the interview." },
];

function NotificationEmailsSection({ hiringEmails, slots }: {
  hiringEmails: Record<string, { subject: string; body: string }>;
  slots: typeof NOTIFICATION_EMAIL_SLOTS;
}) {
  return (
    <SetupCard title="Notification emails" description="The email each notification sends. Shared by every cycle.">
      <div className="flex flex-col gap-2">
        {slots.map((slot) => (
          <HiringEmailEditor
            key={slot.type}
            slot={slot}
            templateSlot={notificationSlot(slot.type)}
            email={hiringEmails[notificationSlot(slot.type)] ?? null}
          />
        ))}
      </div>
    </SetupCard>
  );
}

// One email slot as a well row: what it's for (flagged when no email is
// written yet), with Edit/Write opening the shared subject and body in a modal.
function HiringEmailEditor({ slot, templateSlot, email }: {
  slot: { label: string; description: string };
  templateSlot: TemplateSlot;
  email: { subject: string; body: string } | null;
}) {
  const os = useOsChrome();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [body, setBody] = useState(email?.body ?? "");
  const busy = fetcher.state !== "idle";
  // Close once a save lands; the loader brings the new email back.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setEditing(false);
  }, [fetcher.state, fetcher.data]);
  const open = () => {
    setSubject(email?.subject ?? "");
    setBody(email?.body ?? "");
    setEditing(true);
  };
  const save = () =>
    fetcher.submit({ intent: "save-hiring-email", slot: templateSlot, subject, body }, { method: "post" });
  // Soft warnings only: an unknown or never-filled variable still saves.
  const subjLint = lintTemplate(subject, templateSlot);
  const bodyLint = lintTemplate(body, templateSlot);
  const unknown = Array.from(new Set([...subjLint.unknown, ...bodyLint.unknown]));
  const unfilled = Array.from(new Set([...subjLint.unfilled, ...bodyLint.unfilled]));
  const titleId = `hiring-email-${templateSlot.replace(/[^a-z0-9]/gi, "-")}`;

  return (
    <div className="flex items-start justify-between gap-3 rounded-os-item bg-os-well px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {!email && <AlertIcon label="No email yet" />}
          {slot.label}
        </span>
        <span className="text-sm text-os-grey">{slot.description}</span>
      </div>
      <button type="button" onClick={open} className={cn(buttonClasses("secondary", "sm"), "shrink-0")}>
        {email ? "Edit" : "Write"}
      </button>
      <Modal
        open={editing}
        onClose={busy ? () => {} : () => setEditing(false)}
        disableEscape={busy}
        labelledBy={titleId}
        containerClassName="w-full max-w-4xl my-auto os-modal-card os-form"
      >
        <ModalHeader titleId={titleId} title={`${slot.label} email`} subtitle={slot.description} onClose={() => setEditing(false)} />
        <div className={cn(os.formClass, "flex flex-col gap-4")}>
          <label className={os.fieldLabel}>
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={`${slot.label} subject`} />
          </label>
          <label className={os.fieldLabel}>
            Body
            <textarea
              rows={18}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label={`${slot.label} body`}
            />
          </label>
          <SlotVariableHint slot={templateSlot} />
          {(unknown.length > 0 || unfilled.length > 0) && <PreviewLintWarning unknown={unknown} unfilled={unfilled} />}
          {fetcher.data?.error && <p className="text-sm text-red-700">{fetcher.data.error}</p>}
        </div>
        <ModalFooter onCancel={() => setEditing(false)}>
          <button type="button" disabled={busy} onClick={save} className={buttonClasses("primary", "md")}>
            {busy ? "Saving…" : "Save"}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function SlotVariableHint({ slot }: { slot: TemplateSlot }) {
  const vars = TEMPLATE_VARIABLES[slot];
  return (
    <p className="text-xs text-os-grey">
      Supports{' '}
      {vars.map((v, i) => (
        <span key={v}>
          {i > 0 && ', '}
          <code className="font-mono rounded bg-os-container px-1">{`{{${v}}}`}</code>
        </span>
      ))}
      .
    </p>
  );
}
