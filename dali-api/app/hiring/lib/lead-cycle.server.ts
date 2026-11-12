import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isAdmin, isCore, isCycleAdmin } from "~/lib/roles";
import { listHiringEvents, isEventCheckInOpen } from "~/hiring/lib/hiring-events.server";
import { countAnnouncementRecipients } from "~/hiring/lib/hiring-event-notice";
import { countDomainAddedRecipients } from "~/hiring/lib/domain-added-notice";
import { openSiblingDomains } from "~/hiring/lib/accept-preemption.server";
import QRCode from "qrcode";
import { loadStartTermCandidates } from "~/hiring/lib/start-terms.server";
import { isMemberApplicants } from "~/hiring/lib/applicant-groups";
import { loadMemberCycleSetup, loadPhaseStatusByDomain, loadTermOptions } from "~/hiring/lib/cycle-setup.server";
import { getCycleProgress } from "~/hiring/lib/cycle-phases.server";
import { getHiringEmail, listHiringEmails } from "~/hiring/lib/hiring-emails.server";
import { roundsWithBoards } from "~/hiring/lib/cycle-timeline.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { getPresenceUser } from "~/lib/presence-user";
import { CONTINUED_INTEREST_SLOT } from "~/hiring/lib/email-variables";
import { pendingForHiringLead } from "~/hiring/lib/decision-pills";
import { type HiringEventRow, type EventCheckIn } from "~/hiring/components/cycle-setup/ApplicationEventsCard";
import { confidentialityBlock, getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { sendExtensionNoticeIfDue } from "~/hiring/lib/extension-notice";

export async function loadLeadCycle({ request, params }: { request: Request; params: { id?: string } }) {
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

  // The reads below only need params.id / confidentialityRequired (already
  // known) — none of them depend on another's result — so they run as one
  // wave instead of a dozen sequential round-trips. `rubricVersionOptions` is
  // reused as `domainRubricVersions` afterward rather than querying it twice.
  const [
    cycleBase,
    applications,
    allDomains,
    allForms,
    rubricVersionOptions,
    confidentialityAgreementOptions,
    confidentialityBindingRow,
    confidentialitySignaturesRaw,
    cycleApplicationReviewCount,
    reviewsForCycle,
    pendingDecisions,
    hiringEmailRows,
    continuedInterestEmail,
    roundsWithBoardsSet,
    viewerIsAdmin,
  ] = await Promise.all([
    prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        domains: {
          include: { domain: true },
        },
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        applicationForm: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } } },
        continuedInterestForm: { select: { id: true, name: true } },
        domainChallengeForms: {
          select: {
            id: true,
            domainId: true,
            formId: true,
            form: {
              select: {
                name: true,
                versions: {
                  orderBy: { versionNumber: "desc" },
                  take: 1,
                  select: { versionNumber: true, createdAt: true, createdBy: { select: { firstName: true, lastName: true } } },
                },
              },
            },
          },
        },
      },
    }),
    confidentialityRequired
      ? Promise.resolve([] as never[])
      : prisma.application.findMany({
          where: { applicationCycleId: params.id },
          include: {
            user: true,
            statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
            domainApplications: {
              where: { selected: true },
              include: { domain: true },
            },
          },
        }),
    prisma.domain.findMany({ orderBy: { name: "asc" } }),
    // All Drive Forms — for the application form and challenge pickers in Setup.
    prisma.form.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.rubricVersion.findMany({
      include: { rubric: { select: { name: true } }, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    // Confidentiality agreements are SigningDocuments (kind Confidentiality),
    // bound to the cycle via a SigningBinding (scopeKey "cycle:<id>") and signed
    // as SigningSignatures (roleKey "member"). Reshaped to the picker's original
    // shape so its UI is unchanged.
    prisma.signingDocument.findMany({
      where: { gateScope: "HiringCycle", archivedAt: null },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.signingBinding.findFirst({
      where: { cycleId: params.id, document: { gateScope: "HiringCycle" } },
      include: {
        version: { include: { document: { select: { name: true } } } },
      },
    }),
    prisma.signingSignature.findMany({
      where: {
        roleKey: "member",
        binding: { cycleId: params.id, document: { gateScope: "HiringCycle" } },
      },
      include: { signer: { select: { firstName: true, lastName: true } } },
      orderBy: { signedAt: "asc" },
    }),
    // Even the count of reviews on this cycle is sensitive — it tells anyone
    // pre-signature how far review has progressed. Zero it out when unsigned;
    // the only reader is the rubric-locking UI, which fail-closed locks edits
    // when reviews exist (count > 0). With confidentialityRequired set, the
    // reviewer dashboard is gated anyway, so the rubric lock state is moot.
    confidentialityRequired
      ? Promise.resolve(0)
      : prisma.applicationReview.count({
          where: {
            domainApplication: {
              application: { applicationCycleId: params.id },
            },
          },
        }),
    confidentialityRequired
      ? Promise.resolve([] as never[])
      : prisma.applicationReview.findMany({
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
        }),
    // Every decision row on the cycle, reduced to the ones still awaiting the
    // lead. Drafts belong here on every kind of cycle: one made outside the
    // domain-lead flow (moved by hand, or left behind when the cycle closed)
    // is otherwise invisible, and this is the one place a lead looks.
    confidentialityRequired
      ? Promise.resolve([] as never[])
      : prisma.decision
          .findMany({
            where: {
              domainApplication: {
                application: { applicationCycleId: params.id },
              },
            },
            include: {
              domainApplication: {
                include: {
                  application: {
                    include: {
                      user: { select: { firstName: true, lastName: true, dartmouthEmail: true, netId: true } },
                      startTerm: { select: { code: true } },
                    },
                  },
                  domain: { select: { name: true } },
                },
              },
              madeBy: { select: { firstName: true, lastName: true } },
            },
            orderBy: { createdAt: "desc" },
          })
          .then(pendingForHiringLead),
    // Hiring's emails are shared by every cycle, one per slot (decision or
    // notification). Keyed by slot for the editors, release gating and previews.
    listHiringEmails(),
    // Unlike the rest, this one sends its default copy until Core writes a row.
    getHiringEmail(CONTINUED_INTEREST_SLOT),
    roundsWithBoards(params.id),
    isAdmin(auth.user.sub),
  ]);

  // After the Core gate — this cycle lands in the lead's recents.
  recordRouteVisit(auth.user.sub, `/hiring/lead/cycle/${params.id}`, cycleBase.name, request);

  const cycle = { ...cycleBase, applications };

  // Which domains already have reviews assigned (used to gate rubric edits —
  // once any domain application has a review, changing the rubric out from
  // under it would invalidate scoring). Rubrics aren't domain-specific, so
  // this is the same set of versions as rubricVersionOptions above.
  const domainRubricVersions = rubricVersionOptions;
  const currentConfidentialityBinding = confidentialityBindingRow
    ? {
        confidentialityAgreementVersion: {
          id: confidentialityBindingRow.version.id,
          versionNumber: confidentialityBindingRow.version.versionNumber,
          agreement: { name: confidentialityBindingRow.version.document.name },
        },
      }
    : null;
  const confidentialitySignatures = confidentialitySignaturesRaw.map((s) => ({ user: s.signer }));

  const reviewedDomainIdSet = new Set<string>();
  for (const r of reviewsForCycle) {
    const did = r.domainApplication.domainId ?? null;
    if (did) reviewedDomainIdSet.add(did);
  }
  const reviewedDomainIds = Array.from(reviewedDomainIdSet);

  // An Accept release closes every other still-selected, undecided sibling
  // DomainApplication as AcceptedElsewhere (api.decisions.$id.release.ts). A
  // lead should see, before clicking Release, when that would also cut off a
  // domain whose own window (domain-windows.ts) is still open.
  const pendingDecisionsWithWarnings = await Promise.all(
    pendingDecisions.map(async (d: any) => ({
      ...d,
      openSiblingDomains:
        d.stage === "Final" && d.type === "Accepted"
          ? await openSiblingDomains(d.domainApplicationId)
          : [],
    })),
  );

  const cycleStatus = cycleBase.statusUpdates[0]?.newStatus ?? "Draft";
  // The "Email applicants" button's recipient count is cycle-wide (every
  // non-Withdrawn applicant), not per-domain — compute it once, only when some
  // domain could actually show the button.
  const domainAddedRecipientCount =
    cycleStatus === "Open" && cycleBase.domains.some((d) => d.isReady)
      ? await countDomainAddedRecipients(params.id!)
      : 0;

  const isMemberCycle = isMemberApplicants(cycleBase.applicants);
  const hiringEmails: Record<string, { subject: string; body: string }> = Object.fromEntries(
    hiringEmailRows.map((e) => [e.slot, { subject: e.subject, body: e.body }]),
  );
  if (continuedInterestEmail) hiringEmails[CONTINUED_INTEREST_SLOT] = continuedInterestEmail;

  const memberSetup = isMemberCycle ? await loadMemberCycleSetup(params.id) : null;
  const [progress, termOptions, phaseStatusByDomain, startTermCandidates] = await Promise.all([
    getCycleProgress(params.id),
    loadTermOptions(request),
    confidentialityRequired ? null : loadPhaseStatusByDomain(params.id),
    loadStartTermCandidates(),
  ]);

  // Application events (help hours, socials, info sessions). QR SVGs are built
  // only for events whose check-in is currently open, to keep this loader cheap
  // on cycles with a long event history.
  const [hiringEventRows, announcementRecipientCount] = await Promise.all([
    listHiringEvents(params.id!),
    countAnnouncementRecipients(params.id!),
  ]);
  const hiringEvents: HiringEventRow[] = hiringEventRows.map((e) => ({
    id: e.id,
    kind: e.kind,
    title: e.title,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    location: e.location,
    checkInOpenAt: e.checkInOpenAt ? e.checkInOpenAt.toISOString() : null,
    broadcastAt: e.broadcastAt ? e.broadcastAt.toISOString() : null,
    announcementSentAt: e.announcementSentAt ? e.announcementSentAt.toISOString() : null,
    attendeeCount: e._count.attendances,
  }));
  const origin = new URL(request.url).origin;
  const hiringEventCheckIns: Record<string, EventCheckIn> = {};
  for (const e of hiringEventRows) {
    if (!isEventCheckInOpen(e)) continue;
    const checkInUrl = `${origin}/hiring/events/check-in/${e.id}`;
    hiringEventCheckIns[e.id] = {
      checkInUrl,
      checkInQrSvg: await QRCode.toString(checkInUrl, { type: "svg", margin: 1, width: 200 }),
    };
  }

  const collabToken = await getCollabToken(request);
  const presenceUser = await getPresenceUser(auth.user.sub);

  return {
      cycle,
      memberSetup,
      progress,
      roundsWithBoards: [...roundsWithBoardsSet],
      termOptions,
      startTermCandidates,
      viewerIsAdmin,
      viewerIsCore: !!(await isCore(auth.user.sub, request)),
      phaseStatusByDomain,
      allDomains,
      allForms,
      pendingDecisions: pendingDecisionsWithWarnings,
      rubricVersionOptions,
      cycleApplicationReviewCount,
      hiringEmails,
      domainRubricVersions,
      reviewedDomainIds,
      confidentialityAgreementOptions,
      currentConfidentialityBinding,
      confidentialitySignatures,
      confidentialityRequired,
      hiringEvents,
      hiringEventCheckIns,
      announcementRecipientCount,
      domainAddedRecipientCount,
      collabToken,
      currentUserId: auth.user.sub,
      presenceUserName: presenceUser?.name ?? auth.user.email,
      presencePhotoUrl: presenceUser?.photoUrl ?? null,
      presenceSubtitle: presenceUser?.subtitle ?? null,
    };
}

export type LeadCycleData = Exclude<Awaited<ReturnType<typeof loadLeadCycle>>, Response>;
