import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { requireMember } from "~/lib/roles";
import { getActiveCycleById, getActiveCycles, type ActiveCycle } from "~/hiring/lib/cycles";
import { reconcileDomainApplications } from "~/hiring/lib/domain-application";
import { currentInternDomains } from "~/hiring/lib/intern-eligibility";
import type { Question } from "~/types";
import { normalizeQuestionBodies } from "~/lib/question-blocks.server";
import { findMissingRequired } from "~/lib/form-answers";
import { resolveUserTimeZone } from "~/lib/timezone";
import { APPLICANT_GROUP_CONFIG, applicantGroup, applicantPortalPath } from "./applicant-groups.server";
import { getCoreDomain } from "./core-hiring.server";
import { loadHiringForm } from "./application-form.server";
import { loadApplicationTracker } from "./application-tracker.server";

// Shared loader/action for the member-authed applicant portals (Interns at
// /fellowship, Lab members at /core/apply). The two routes are thin wrappers
// that pass their applicant group and optional :cycleId; everything that
// differs (eligibility, whether the applicant picks target domains, the
// "you're currently in…" hint) is driven by the registry. Several cycles for a
// group may be open at once: without an id the portal renders the only one, or
// a chooser when there are more.

export type MemberApplicants = "Interns" | "LabMembers";

export type PortalDomain = { id: string; code: string; displayName: string };

export type PortalCycleChoice = { id: string; name: string; closeDate: string | null; href: string };

export type PortalLoaderData =
  | { reason: "not-member" }
  | { reason: "not-eligible" }
  | { reason: "no-active-cycle"; contextDomains: PortalDomain[] }
  | { reason: "choose-cycle"; cycles: PortalCycleChoice[]; viewerTimeZone: string; contextDomains: PortalDomain[] }
  | {
      reason: "ok";
      showDomainPicker: boolean;
      portalPath: string;
      viewerTimeZone: string;
      cycle: {
        id: string;
        name: string;
        currentStatus: string;
        closeDate: string | null;
        formVersionId: string;
        questions: Question[];
        targetDomains: PortalDomain[];
      };
      contextDomains: PortalDomain[];
      draft: {
        id: string;
        status: string | null;
        answers: Record<string, string>;
        selectedDomainIds: string[];
      } | null;
      // Per-domain stages once the application is submitted.
      tracker: {
        hasInterviews: boolean;
        slotDurationMinutes: number;
        domainApplications: Awaited<ReturnType<typeof loadApplicationTracker>>["domainApplications"];
      } | null;
    };

// The single synthetic CORE domain that Core applications hang off of.
async function coreTargetDomains(): Promise<PortalDomain[]> {
  const d = await getCoreDomain();
  return d ? [{ id: d.id, code: d.code, displayName: d.displayName }] : [];
}

/**
 * The cycle a portal request is about. With an id: that cycle, if it's active
 * and for this group. Without one (or an id that doesn't fit): the group's
 * active cycles, so the caller can render the only one or offer a choice.
 */
async function resolvePortalCycle(
  applicants: MemberApplicants,
  cycleId: string | undefined,
): Promise<{ cycle: ActiveCycle } | { choices: ActiveCycle[] }> {
  if (cycleId) {
    const cycle = await getActiveCycleById(cycleId);
    if (cycle && cycle.applicants === applicants) return { cycle };
  }
  const active = await getActiveCycles({ applicants });
  return active.length === 1 ? { cycle: active[0] } : { choices: active };
}

export async function loadInternalCyclePortal(
  request: Request,
  applicants: MemberApplicants,
  cycleId: string | undefined,
): Promise<PortalLoaderData> {
  const auth = await requireAuth(request);
  // Not signed in — bounce to login (thrown so the return type stays data-only).
  if (!auth.ok) throw redirectToLogin(request);

  const member = await requireMember(auth.user.sub);
  if (!member) return { reason: "not-member" };

  if (!(await APPLICANT_GROUP_CONFIG[applicants].eligible!(auth.user.sub))) {
    return { reason: "not-eligible" };
  }

  // Interns see "you're converting from <intern domain>"; Lab members have no
  // such hint.
  const contextDomains: PortalDomain[] =
    applicants === "Interns" ? await currentInternDomains(auth.user.sub) : [];

  const viewer = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { timeZone: true },
  });
  const viewerTimeZone = resolveUserTimeZone(viewer);

  const resolved = await resolvePortalCycle(applicants, cycleId);
  if ("choices" in resolved) {
    if (resolved.choices.length === 0) return { reason: "no-active-cycle", contextDomains };
    return {
      reason: "choose-cycle",
      viewerTimeZone,
      contextDomains,
      cycles: resolved.choices.map((c) => ({
        id: c.id,
        name: c.name,
        closeDate: c.closeDate ? c.closeDate.toISOString() : null,
        href: applicantPortalPath(applicants, c.id),
      })),
    };
  }
  const active = resolved.cycle;
  const config = applicantGroup(applicants, active.id);
  const showDomainPicker = config.domainStrategy === "target-domains";

  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: active.id },
    include: {
      domains: { include: { domain: true } },
    },
  });
  if (!cycle || !cycle.applicationFormId) {
    return { reason: "no-active-cycle", contextDomains };
  }
  // The cycle's application form (a Drive Form) at its latest version.
  const form = await loadHiringForm(cycle.applicationFormId, auth.user.sub);
  if (!form) return { reason: "no-active-cycle", contextDomains };

  // target-domains cycles let the applicant pick from the cycle's real target
  // domains; single-core-domain cycles auto-select the one CORE domain.
  const targetDomains: PortalDomain[] = showDomainPicker
    ? cycle.domains.map((d) => ({ id: d.domainId, code: d.domain.code, displayName: d.domain.displayName }))
    : await coreTargetDomains();

  const draft = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: active.id },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domainApplications: { select: { id: true, domainId: true, selected: true } },
    },
  });
  const status = draft?.statusUpdates[0]?.newStatus ?? null;
  const tracker =
    status === "Submitted"
      ? await loadApplicationTracker(auth.user.sub, active.id, active.currentStatus)
      : null;

  return {
    reason: "ok",
    showDomainPicker,
    portalPath: config.portalPath,
    viewerTimeZone,
    cycle: {
      id: cycle.id,
      name: cycle.name,
      currentStatus: active.currentStatus,
      closeDate: cycle.closeDate ? cycle.closeDate.toISOString() : null,
      formVersionId: form.versionId,
      // Frozen versions may hold legacy ProseMirror info bodies — convert on
      // read so the fill UI only ever sees string | blocks.
      questions: normalizeQuestionBodies(form.questions),
      targetDomains,
    },
    contextDomains,
    draft: draft
      ? {
          id: draft.id,
          status,
          answers: (draft.answers as Record<string, string>) ?? {},
          selectedDomainIds: draft.domainApplications
            .filter((da) => da.selected && da.domainId)
            .map((da) => da.domainId as string),
        }
      : null,
    tracker: tracker
      ? {
          hasInterviews: cycle.hasInterviews,
          slotDurationMinutes: tracker.slotDurationMinutes,
          domainApplications: tracker.domainApplications,
        }
      : null,
  };
}

export async function handleInternalCyclePortalAction(
  request: Request,
  applicants: MemberApplicants,
  cycleId: string | undefined,
): Promise<Response | { saved: true } | { submitted: true } | { withdrawn: true }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const member = await requireMember(auth.user.sub);
  if (!member) return Response.json({ error: "Not a lab member" }, { status: 403 });

  // The form posts to its cycle's own URL, so a write always names its cycle.
  const active = cycleId ? await getActiveCycleById(cycleId) : null;
  if (!active || active.applicants !== applicants) {
    return Response.json({ error: "No active cycle" }, { status: 404 });
  }
  const config = applicantGroup(applicants, active.id);
  const showDomainPicker = config.domainStrategy === "target-domains";

  if (!(await config.eligible!(auth.user.sub))) {
    return Response.json({ error: "Not eligible" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (active.currentStatus !== "Open" && intent !== "withdraw") {
    return Response.json({ error: "Cycle is not open" }, { status: 409 });
  }

  if (intent === "save-draft" || intent === "submit") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: active.id },
      include: {
        domains: { select: { domainId: true } },
      },
    });
    if (!cycle.applicationFormId) {
      return Response.json({ error: "Cycle is not configured" }, { status: 409 });
    }
    const form = await loadHiringForm(cycle.applicationFormId, auth.user.sub);
    if (!form) {
      return Response.json({ error: "Cycle is not configured" }, { status: 409 });
    }
    const formVersionId = form.versionId;
    const questions = form.questions;
    const allowedDomainIds = new Set(cycle.domains.map((d) => d.domainId));

    const answers = JSON.parse((formData.get("answers") as string) || "{}") as Record<string, string>;
    // target-domains cycles read the applicant's picks; single-core-domain
    // cycles ignore any client input and target every linked domain (the one
    // CORE domain).
    const selectedDomainIds = showDomainPicker
      ? (JSON.parse((formData.get("selectedDomainIds") as string) || "[]") as string[]).filter((id) =>
          allowedDomainIds.has(id),
        )
      : [...allowedDomainIds];

    if (intent === "submit") {
      const missing = findMissingRequired(questions, (q) => answers[q.key]).map(
        (q) => q.data.label || q.key,
      );
      if (missing.length > 0) {
        return Response.json(
          { error: `Please answer all required questions (${missing.length} unanswered).` },
          { status: 400 },
        );
      }
      if (selectedDomainIds.length === 0) {
        return Response.json(
          {
            error: showDomainPicker
              ? "Select at least one target domain before submitting."
              : "This cycle is not configured — no target to apply to.",
          },
          { status: 400 },
        );
      }
    }

    // Upsert the Application (one per user+cycle). Pin the form version on
    // create and never re-pin on subsequent saves.
    const application = await prisma.application.upsert({
      where: {
        userId_applicationCycleId: { userId: auth.user.sub, applicationCycleId: active.id },
      },
      update: { answers },
      create: {
        userId: auth.user.sub,
        applicationCycleId: active.id,
        applicationType: config.applicationType,
        applicationFormVersionId: formVersionId,
        answers,
        statusUpdates: { create: { newStatus: "Draft", userId: auth.user.sub } },
      },
    });

    await reconcileDomainApplications({ applicationId: application.id, domainIds: selectedDomainIds });

    if (intent === "submit") {
      const alreadySubmitted = await prisma.applicationStatusUpdate.findFirst({
        where: { applicationId: application.id, newStatus: "Submitted" },
      });
      if (!alreadySubmitted) {
        await prisma.applicationStatusUpdate.create({
          data: { applicationId: application.id, newStatus: "Submitted", userId: auth.user.sub },
        });
      }
      return { submitted: true };
    }

    return { saved: true };
  }

  if (intent === "withdraw") {
    const application = await prisma.application.findFirst({
      where: { userId: auth.user.sub, applicationCycleId: active.id },
    });
    if (!application) return Response.json({ error: "No application found" }, { status: 404 });
    const alreadyWithdrawn = await prisma.applicationStatusUpdate.findFirst({
      where: { applicationId: application.id, newStatus: "Withdrawn" },
    });
    if (alreadyWithdrawn) return { withdrawn: true };
    await prisma.applicationStatusUpdate.create({
      data: { applicationId: application.id, newStatus: "Withdrawn", userId: auth.user.sub },
    });
    return { withdrawn: true };
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}
