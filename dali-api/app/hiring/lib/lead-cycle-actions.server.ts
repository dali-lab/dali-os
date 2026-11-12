import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { isAdmin } from "~/lib/roles";
import { sendDomainAddedNotice } from "~/hiring/lib/domain-added-notice";
import { changeApplicants } from "~/hiring/lib/cycle-applicants.server";
import { invalidateActiveCycles } from "~/hiring/lib/cycles";
import { canEditDomainSetup, setDomainReady } from "~/hiring/lib/domain-windows.server";
import { parseStartTermIds, reflowStartTermsForTermChange, setCycleStartTerms } from "~/hiring/lib/start-terms.server";
import { APPLICANT_GROUPS, defaultTimelineFor } from "~/hiring/lib/applicant-groups";
import type { CycleApplicants } from "~/generated/prisma/enums";
import { endOfDayInAppTz, startOfDayInAppTz } from "~/hiring/lib/cycle-setup.server";
import { defaultApplicationWindow } from "~/hiring/lib/cycle-phases";
import { openTimelineChange, parseTimeline, validateTimeline, type Timeline } from "~/hiring/lib/cycle-timeline";
import { addDomainMentors, domainMentorIds } from "~/hiring/lib/cycle-rosters.server";
import { roundsWithBoards, saveCycleTimeline } from "~/hiring/lib/cycle-timeline.server";
import { addDomainChallenge, createCycleApplicationForm, createCycleContinuedInterestForm, removeDomainChallenge } from "~/hiring/lib/application-form.server";
import { resendExtensionNotice } from "~/hiring/lib/extension-notice";
import { zonedDayStartUtc, zonedDayEndUtc, getZonedYMD, APPLICATION_TZ } from "~/lib/timezone";
import type { Prisma } from "~/generated/prisma/client";

/**
 * Redirect back to the same cycle page, preserving the active ?tab= so a form
 * submission on (e.g.) Setup doesn't bounce the user to another phase. Extra params
 * (e.g. notice keys) are appended after.
 */
export function cycleRedirect(
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
export async function reopenIfNeeded(
  tx: Prisma.TransactionClient,
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
  invalidateActiveCycles();
  return true;
}


async function applyTerm(cycleId: string, termId: string | null, fillDefaultWindow: boolean): Promise<Response | null> {
  const term = termId
    ? await prisma.term.findUnique({ where: { id: termId }, select: { startDate: true } })
    : null;
  if (termId && !term) return Response.json({ error: "Unknown term" }, { status: 400 });
  const dates = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    select: { openDate: true, closeDate: true },
  });
  // A new cycle gets the standard window (Weeks 4 to 5) as a starting point;
  // dates a lead already chose are never overwritten.
  const window =
    fillDefaultWindow && term && !dates?.openDate && !dates?.closeDate
      ? defaultApplicationWindow(term.startDate)
      : null;
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: {
      termId,
      ...(window && {
        openDate: startOfDayInAppTz(window.open),
        closeDate: endOfDayInAppTz(window.closeDay),
      }),
    },
  });
  // Moving the cycle's term can push offered start terms below the new floor
  // (and invalidate picks made against them). Re-floored here, in the single
  // writer of termId, so no caller can move the term and skip it.
  await reflowStartTermsForTermChange(cycleId);
  return null;
}

async function applyOpenDate(cycleId: string, raw: string | null): Promise<Date | null> {
  let openDate: Date | null = null;
  if (raw) {
    const [y, m, d] = raw.split("-").map(Number);
    openDate = zonedDayStartUtc(y, m, d, APPLICATION_TZ);
  }
  await prisma.applicationCycle.update({ where: { id: cycleId }, data: { openDate } });
  return openDate;
}

/** Returns the notice to show. */
async function applyCloseDate(cycleId: string, actorId: string, raw: string | null): Promise<string> {
  let parsedClose: Date | null = null;
  if (raw) {
    // Deadline is 11:59:59 PM Eastern on the selected date so applicants get
    // the full day in the lab's local time (not late evening UTC).
    const [y, m, d] = raw.split("-").map(Number);
    parsedClose = zonedDayEndUtc(y, m, d, APPLICATION_TZ);
  }
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
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
      where: { id: cycleId },
      data: { closeDate: nextClose, originalCloseDate: nextOriginal },
    });
    return await reopenIfNeeded(tx, cycleId, cycle, nextClose, actorId);
  });
  return parsedClose ? (reopened ? "deadline-set-reopened" : "deadline-set") : "deadline-cleared";
}


export interface LeadCycleActionContext {
  request: Request;
  formData: FormData;
  intent: string;
  cycleId: string;
  actorId: string;
  applicants: CycleApplicants;
}

export type LeadCycleActionHandler = (ctx: LeadCycleActionContext) => Promise<Response | { ok: true }>;

const setStagesAction: LeadCycleActionHandler = async ({ formData, cycleId }) => {
  const stage = formData.get("stage") as string;
  // Delib rounds and Interviews live on the timeline now (set-timeline).
  if (stage !== "hasChallenges") {
    return Response.json({ error: "Unknown stage" }, { status: 400 });
  }
  const latest = await prisma.applicationCycleStatusUpdate.findFirst({
    where: { applicationCycleId: cycleId },
    orderBy: { createdAt: "desc" },
    select: { newStatus: true },
  });
  if ((latest?.newStatus ?? "Draft") !== "Draft") {
    return Response.json({ error: "Stages lock once the cycle opens." }, { status: 409 });
  }
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { [stage]: formData.get("value") === "true" },
  });
  return { ok: true as const };
};

const saveTermDatesAction: LeadCycleActionHandler = async ({ request, formData, cycleId, actorId }) => {
  const termId = (formData.get("termId") as string) || null;
  const openRaw = (formData.get("openDate") as string) || null;
  const closeRaw = (formData.get("closeDate") as string) || null;
  const before = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: cycleId },
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
  const bad = await applyTerm(cycleId, termId, !openRaw && !closeRaw);
  if (bad) return bad;
  // After applyTerm, so the start terms in this same save are floored at the
  // term this save just set rather than the one it replaced. Absent field =
  // a card rendered without the picker (non-Students, or the flag off), which
  // must leave the stored set alone rather than clear it.
  const startTermsRaw = formData.get("startTermIds");
  if (typeof startTermsRaw === "string") {
    await setCycleStartTerms(cycleId, parseStartTermIds(startTermsRaw));
  }
  // Only touch a date that actually changed, so saving the term alone never
  // disturbs an active extension. The open date is fixed once applications open.
  if (openRaw !== ymd(before.openDate) && (before.statusUpdates[0]?.newStatus ?? "Draft") === "Draft") {
    await applyOpenDate(cycleId, openRaw);
  }
  // Absent fields = a card rendered without them (in-app decision cycles).
  const respondBy: { offerRespondBy?: Date | null; waitlistRespondBy?: Date | null } = {};
  for (const key of ["offerRespondBy", "waitlistRespondBy"] as const) {
    const raw = formData.get(key);
    if (typeof raw !== "string") continue;
    const [y, m, d] = raw.split("-").map(Number);
    respondBy[key] = raw ? zonedDayEndUtc(y, m, d, APPLICATION_TZ) : null;
  }
  if (Object.keys(respondBy).length > 0) {
    await prisma.applicationCycle.update({ where: { id: cycleId }, data: respondBy });
  }
  if (closeRaw !== ymd(before.originalCloseDate ?? before.closeDate) && (openRaw || closeRaw || before.closeDate)) {
    const notice = await applyCloseDate(cycleId, actorId, closeRaw);
    if (notice === "deadline-past") return cycleRedirect(request, cycleId, { notice });
  }
  return cycleRedirect(request, cycleId, { notice: "term-dates-saved" });
};

const setApplicantsAction: LeadCycleActionHandler = async ({ request, formData, cycleId, actorId, applicants }) => {
  const next = formData.get("applicants") as CycleApplicants;
  if (!APPLICANT_GROUPS.includes(next)) {
    return Response.json({ error: "Unknown applicant group" }, { status: 400 });
  }
  const error = await changeApplicants(cycleId, next, await isAdmin(actorId));
  if (error === "not-draft") {
    return Response.json({ error: "Applicants lock once the cycle opens." }, { status: 409 });
  }
  if (error === "admin-only") {
    return Response.json({ error: "Only Admins can run Lab members cycles." }, { status: 403 });
  }
  return cycleRedirect(request, cycleId, { notice: "applicants-changed" });
};

const setTimelineAction: LeadCycleActionHandler = async ({ request, formData, cycleId, applicants }) => {
  const reset = !!formData.get("reset");
  let next: Timeline;
  try {
    next = reset ? defaultTimelineFor(applicants) : JSON.parse(formData.get("timeline") as string);
  } catch {
    next = null as unknown as Timeline;
  }
  if (!Array.isArray(next) || !next.every((b) => b && typeof b === "object" && Array.isArray(b.weeks))) {
    return Response.json({ error: "Couldn't read the timeline." }, { status: 400 });
  }
  const invalid = validateTimeline(next);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  const [stored, latest, withBoards] = await Promise.all([
    prisma.applicationCycle.findUnique({ where: { id: cycleId }, select: { timeline: true } }),
    prisma.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId },
      orderBy: { createdAt: "desc" },
      select: { newStatus: true },
    }),
    roundsWithBoards(cycleId),
  ]);
  if ((latest?.newStatus ?? "Draft") !== "Draft") {
    const refused = openTimelineChange(parseTimeline(stored?.timeline), next, withBoards);
    if (refused) return Response.json({ error: refused }, { status: 409 });
  }
  const error = await saveCycleTimeline(cycleId, next);
  if (error) return Response.json({ error }, { status: 400 });
  return cycleRedirect(request, cycleId, { notice: reset ? "timeline-reset" : "timeline-saved" });
};

const challengeFormAction: LeadCycleActionHandler = async ({ request, formData, intent, cycleId, actorId }) => {
  const refused =
    intent === "create-challenge-form"
      ? await addDomainChallenge(
          cycleId,
          formData.get("domainId") as string,
          actorId,
          (formData.get("formId") as string) || null,
          request,
        )
      : await removeDomainChallenge(formData.get("cdfId") as string, cycleId, {
          actorId: actorId,
          request,
        });
  if (refused === "not-draft") {
    return Response.json({ error: "Challenges lock once the cycle opens." }, { status: 409 });
  }
  if (refused === "in-use") {
    return Response.json({ error: "An applicant already picked this challenge." }, { status: 409 });
  }
  if (refused === "not-found") return Response.json({ error: "Not found" }, { status: 404 });
  return cycleRedirect(request, cycleId);
};

const setTermAction: LeadCycleActionHandler = async ({ request, formData, cycleId }) => {
  const bad = await applyTerm(cycleId, (formData.get("termId") as string) || null, true);
  return bad ?? cycleRedirect(request, cycleId);
};

const setOpenDateAction: LeadCycleActionHandler = async ({ request, formData, cycleId }) => {
  const openDate = await applyOpenDate(cycleId, (formData.get("openDate") as string) || null);
  return cycleRedirect(request, cycleId, { notice: openDate ? "open-date-set" : "open-date-cleared" });
};

const setCloseDateAction: LeadCycleActionHandler = async ({ request, formData, cycleId, actorId }) => {
  const notice = await applyCloseDate(cycleId, actorId, (formData.get("closeDate") as string) || null);
  return cycleRedirect(request, cycleId, { notice });
};

const extendCloseDateAction: LeadCycleActionHandler = async ({ request, formData, cycleId, actorId }) => {
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
    where: { id: cycleId },
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
      where: { id: cycleId },
      data: { closeDate: nextClose, originalCloseDate: anchor },
    });
    return await reopenIfNeeded(tx, cycleId, cycle, nextClose, actorId);
  });
  const notice = reopened ? "extended-reopened" : "extended";
  return cycleRedirect(request, cycleId, { notice });
};

const removeExtensionAction: LeadCycleActionHandler = async ({ request, cycleId }) => {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
  });
  if (!cycle?.originalCloseDate) {
    // No extension to remove — just no-op.
    return cycleRedirect(request, cycleId);
  }
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    // Snap back to the original deadline; clear the extension marker.
    // extensionNoticeSentAt is also cleared so a future re-extension can
    // re-trigger the notice blast.
    data: {
      closeDate: cycle.originalCloseDate,
      originalCloseDate: null,
      extensionNoticeSentAt: null,
    },
  });
  return cycleRedirect(request, cycleId, { notice: "extension-removed" });
};

const resendExtensionNoticeAction: LeadCycleActionHandler = async ({ request, cycleId }) => {
  const result = await resendExtensionNotice(cycleId);
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
  return cycleRedirect(request, cycleId, {
    notice,
    sent: result.succeeded,
    failed: result.failed,
    skipped: result.alreadySent,
  });
};

const setGeneralRubricAction: LeadCycleActionHandler = async ({ request, formData, cycleId }) => {
  const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
  const hasAssignedReviews = await prisma.applicationReview.count({
    where: {
      domainApplication: {
        application: { applicationCycleId: cycleId },
      },
    },
  });
  if (hasAssignedReviews > 0) {
    return cycleRedirect(request, cycleId);
  }
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { generalRubricVersionId: rubricVersionId },
  });
  return cycleRedirect(request, cycleId);
};

const setAnonymizeReviewAction: LeadCycleActionHandler = async ({ request, formData, cycleId }) => {
  // Blind review toggle. Unchecked checkboxes are omitted from the form body,
  // so absence means "off".
  const anonymizeReview = formData.get("anonymizeReview") === "on";
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { anonymizeReview },
  });
  return cycleRedirect(request, cycleId);
};

const setConfidentialityAgreementAction: LeadCycleActionHandler = async ({ request, formData, cycleId }) => {
  const versionId =
    (formData.get("confidentialityAgreementVersionId") as string) || null;
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
  return cycleRedirect(request, cycleId);
};

const addDomainMentorsAction: LeadCycleActionHandler = async ({ request, formData, cycleId, actorId }) => {
  const role = formData.get("role");
  if (role !== "reviewer" && role !== "interviewer") {
    return Response.json({ error: "Unknown roster" }, { status: 400 });
  }
  const domainId = formData.get("domainId") as string;
  const inCycle = await prisma.domainApplicationCycle.findUnique({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    select: { domainId: true },
  });
  if (!inCycle) return Response.json({ error: "That domain isn't in this cycle." }, { status: 400 });
  const round = (formData.get("interviewRoundId") as string | null) || undefined;
  const added = await addDomainMentors(cycleId, domainId, role, request, round, actorId);
  // Nothing added means either no mentors, or all of them already on it.
  const notice =
    added > 0 ? "mentors-added" : (await domainMentorIds(domainId, request)).length ? "mentors-already" : "mentors-none";
  return cycleRedirect(request, cycleId, { notice, added });
};

const createApplicationFormAction: LeadCycleActionHandler = async ({ request, cycleId, actorId }) => {
  // Auto-create + bind a Drive Form as this cycle's general application form
  // (no-op if already bound). Takes precedence over any legacy general-form link.
  await createCycleApplicationForm(cycleId, actorId);
  return cycleRedirect(request, cycleId);
};

const setApplicationFormAction: LeadCycleActionHandler = async ({ request, formData, cycleId }) => {
  const formId = (formData.get("formId") as string) || null;
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { applicationFormId: formId },
  });
  return cycleRedirect(request, cycleId);
};

const createContinuedInterestFormAction: LeadCycleActionHandler = async ({ request, cycleId, actorId }) => {
  await createCycleContinuedInterestForm(cycleId, actorId);
  return cycleRedirect(request, cycleId);
};

const setContinuedInterestFormAction: LeadCycleActionHandler = async ({ request, formData, cycleId }) => {
  const formId = (formData.get("formId") as string) || null;
  await prisma.applicationCycle.update({
    where: { id: cycleId },
    data: { continuedInterestFormId: formId },
  });
  return cycleRedirect(request, cycleId);
};

const hlSetDomainRubricAction: LeadCycleActionHandler = async ({ request, formData, cycleId, actorId }) => {
  const domainId = formData.get("domainId") as string;
  const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
  if (!domainId) {
    return cycleRedirect(request, cycleId);
  }
  // Once any review is assigned for this domain in this cycle, the rubric
  // is locked: changing it would silently invalidate prior scores.
  const hasAssignedReviews = await prisma.applicationReview.count({
    where: {
      domainApplication: {
        domainId,
        application: { applicationCycleId: cycleId },
      },
    },
  });
  if (hasAssignedReviews > 0) {
    return cycleRedirect(request, cycleId);
  }
  if (rubricVersionId) {
    const rv = await prisma.rubricVersion.findUnique({
      where: { id: rubricVersionId },
    });
    if (!rv) {
      return cycleRedirect(request, cycleId);
    }
  }
  const rubricKey = { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } };
  const previous = await prisma.domainApplicationCycle.findUnique({
    where: rubricKey,
    select: { rubricVersionId: true },
  });
  await prisma.domainApplicationCycle.upsert({
    where: rubricKey,
    update: { rubricVersionId },
    create: { domainId, applicationCycleId: cycleId, rubricVersionId },
  });
  await logAuditEvent({
    action: "domain.rubric.set",
    userId: actorId,
    targetId: domainId,
    metadata: { cycleId: cycleId, before: previous?.rubricVersionId ?? null, after: rubricVersionId },
    request,
  });
  return cycleRedirect(request, cycleId);
};

const forceReadyAction: LeadCycleActionHandler = async ({ request, formData, intent, cycleId, actorId }) => {
  const domainId = formData.get("domainId") as string;
  const confirm = formData.get("confirm");
  if (!domainId || confirm !== "true") {
    return cycleRedirect(request, cycleId);
  }
  const refused = await setDomainReady(cycleId, domainId, intent === "hl-force-mark-ready", {
    actorId: actorId,
    request,
    forced: true,
  });
  if (refused) {
    return new Response(JSON.stringify({ error: refused }), { status: 409, headers: { "Content-Type": "application/json" } });
  }
  return cycleRedirect(request, cycleId);
};

const domainMembershipAction: LeadCycleActionHandler = async ({ request, formData, intent, cycleId, applicants }) => {
  const domainId = formData.get("domainId") as string;
  const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
    where: { applicationCycleId: cycleId },
    orderBy: { createdAt: "desc" },
  });
  const status = latestUpdate?.newStatus ?? "Draft";
  // A domain joins an Open cycle staged (not ready), invisible to applicants
  // until its lead marks it ready. Removal after Open is only for a staged one.
  const allowed =
    intent === "add-domain"
      ? status === "Draft" || status === "Open"
      : await canEditDomainSetup(cycleId, domainId);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Domains can only be modified in Draft, or staged while Open" }), { status: 409, headers: { "Content-Type": "application/json" } });
  }
  if (intent === "remove-domain") {
    await prisma.domainApplicationCycle.delete({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    });
  } else {
    await prisma.domainApplicationCycle.create({
      data: { domainId, applicationCycleId: cycleId },
    });
  }
  return cycleRedirect(request, cycleId);
};

const setDomainCloseDateAction: LeadCycleActionHandler = async ({ formData, cycleId }) => {
  const domainId = formData.get("domainId") as string;
  if (!domainId) return Response.json({ error: "Missing domain" }, { status: 400 });
  const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
    where: { applicationCycleId: cycleId },
    orderBy: { createdAt: "desc" },
    select: { newStatus: true },
  });
  const status = latestUpdate?.newStatus ?? "Draft";
  if (status !== "Draft" && status !== "Open") {
    return Response.json(
      { error: "Domain close dates can only change while the cycle is Draft or Open." },
      { status: 409 },
    );
  }
  const raw = (formData.get("closeDate") as string) || null;
  let closeDate: Date | null = null;
  if (raw) {
    const [y, m, d] = raw.split("-").map(Number);
    closeDate = endOfDayInAppTz(new Date(Date.UTC(y, m - 1, d)));
    if (closeDate.getTime() < Date.now()) {
      return Response.json({ error: "Pick a date that hasn't passed" }, { status: 400 });
    }
  }
  await prisma.domainApplicationCycle.update({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    data: { closeDate },
  });
  invalidateActiveCycles();
  return { ok: true as const };
};

const notifyDomainAddedAction: LeadCycleActionHandler = async ({ request, formData, cycleId, actorId }) => {
  const domainId = formData.get("domainId") as string;
  const confirm = formData.get("confirm");
  if (!domainId || confirm !== "true") {
    return cycleRedirect(request, cycleId);
  }
  const latestUpdate = await prisma.applicationCycleStatusUpdate.findFirst({
    where: { applicationCycleId: cycleId },
    orderBy: { createdAt: "desc" },
    select: { newStatus: true },
  });
  const status = latestUpdate?.newStatus ?? "Draft";
  const dac = await prisma.domainApplicationCycle.findUnique({
    where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
    select: { isReady: true },
  });
  if (status !== "Open" || !dac?.isReady) {
    return Response.json(
      { error: "This domain can only be announced while the cycle is Open and the domain is ready." },
      { status: 409 },
    );
  }
  const result = await sendDomainAddedNotice(cycleId, domainId, actorId);
  const attempted = result.sent + result.alreadySent + result.skipped;
  let notice: string;
  if (attempted === 0) {
    notice = "domain-added-notice-noop";
  } else if (result.sent === 0 && result.alreadySent === attempted) {
    notice = "domain-added-notice-all-sent";
  } else if (result.sent === 0 && result.skipped === attempted) {
    notice = "domain-added-notice-not-configured";
  } else if (result.skipped > 0) {
    notice = "domain-added-notice-partial";
  } else {
    notice = "domain-added-notice-sent";
  }
  return cycleRedirect(request, cycleId, {
    notice,
    sent: result.sent,
    skipped: result.skipped,
    alreadySent: result.alreadySent,
  });
};

export const LEAD_CYCLE_ACTIONS: Record<string, LeadCycleActionHandler> = {
  "set-stages": setStagesAction,
  "save-term-dates": saveTermDatesAction,
  "set-applicants": setApplicantsAction,
  "set-timeline": setTimelineAction,
  "create-challenge-form": challengeFormAction,
  "remove-challenge-form": challengeFormAction,
  "set-term": setTermAction,
  "set-open-date": setOpenDateAction,
  "set-close-date": setCloseDateAction,
  "extend-close-date": extendCloseDateAction,
  "remove-extension": removeExtensionAction,
  "resend-extension-notice": resendExtensionNoticeAction,
  "set-general-rubric": setGeneralRubricAction,
  "set-anonymize-review": setAnonymizeReviewAction,
  "set-confidentiality-agreement": setConfidentialityAgreementAction,
  "add-domain-mentors": addDomainMentorsAction,
  "create-application-form": createApplicationFormAction,
  "set-application-form": setApplicationFormAction,
  "create-continued-interest-form": createContinuedInterestFormAction,
  "set-continued-interest-form": setContinuedInterestFormAction,
  "hl-set-domain-rubric": hlSetDomainRubricAction,
  "hl-force-mark-ready": forceReadyAction,
  "hl-force-unmark-ready": forceReadyAction,
  "remove-domain": domainMembershipAction,
  "add-domain": domainMembershipAction,
  "set-domain-close-date": setDomainCloseDateAction,
  "notify-domain-added": notifyDomainAddedAction,
};
