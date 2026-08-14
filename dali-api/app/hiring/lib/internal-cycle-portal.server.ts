import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { requireMember } from "~/lib/roles";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { reconcileDomainApplications } from "~/hiring/lib/domain-application";
import { currentInternDomains } from "~/hiring/lib/intern-eligibility";
import type { Question } from "~/types";
import { normalizeQuestionBodies } from "~/lib/question-blocks.server";
import { findMissingRequired } from "~/lib/form-answers";
import { resolveUserTimeZone } from "~/lib/timezone";
import { INTERNAL_CYCLES, type InternalCycleType } from "./internal-cycles.server";
import { getCoreDomain } from "./core-hiring.server";

// Shared loader/action for the member-authed internal-cycle applicant portal
// (Fellowship and Core). The two routes are thin wrappers that pass their
// cycleType; everything that differs (eligibility, whether the applicant picks
// target domains, the "you're currently in…" hint) is driven by the registry.

export type PortalDomain = { id: string; code: string; displayName: string };

export type PortalLoaderData =
  | { reason: "not-member" }
  | { reason: "not-eligible"; cycleType: InternalCycleType }
  | { reason: "no-active-cycle"; cycleType: InternalCycleType; contextDomains: PortalDomain[] }
  | {
      reason: "ok";
      cycleType: InternalCycleType;
      showDomainPicker: boolean;
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
    };

// The single synthetic CORE domain that Core applications hang off of.
async function coreTargetDomains(): Promise<PortalDomain[]> {
  const d = await getCoreDomain();
  return d ? [{ id: d.id, code: d.code, displayName: d.displayName }] : [];
}

export async function loadInternalCyclePortal(
  request: Request,
  cycleType: InternalCycleType,
): Promise<PortalLoaderData> {
  const config = INTERNAL_CYCLES[cycleType];
  const showDomainPicker = config.domainStrategy === "target-domains";

  const auth = await requireAuth(request);
  // Not signed in — bounce to login (thrown so the return type stays data-only).
  if (!auth.ok) throw redirectToLogin(request);

  const member = await requireMember(auth.user.sub);
  if (!member) return { reason: "not-member" };

  if (!(await config.eligible(auth.user.sub))) {
    return { reason: "not-eligible", cycleType };
  }

  // Fellowship shows "you're converting from <intern domain>"; Core has no
  // such hint.
  const contextDomains: PortalDomain[] =
    cycleType === "Fellowship" ? await currentInternDomains(auth.user.sub) : [];

  const active = await getActiveCycle(cycleType);
  if (!active) return { reason: "no-active-cycle", cycleType, contextDomains };

  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: active.id },
    include: {
      shortformVersion: true,
      domains: { include: { domain: true } },
    },
  });
  if (!cycle || !cycle.shortformVersion) {
    return { reason: "no-active-cycle", cycleType, contextDomains };
  }

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

  const viewer = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { timeZone: true },
  });

  return {
    reason: "ok",
    cycleType,
    showDomainPicker,
    viewerTimeZone: resolveUserTimeZone(viewer),
    cycle: {
      id: cycle.id,
      name: cycle.name,
      currentStatus: active.currentStatus,
      closeDate: cycle.closeDate ? cycle.closeDate.toISOString() : null,
      formVersionId: cycle.shortformVersionId!,
      // Frozen versions may hold legacy ProseMirror info bodies — convert on
      // read so the fill UI only ever sees string | blocks.
      questions: normalizeQuestionBodies(
        (cycle.shortformVersion.questions as unknown as Question[]) ?? [],
      ),
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
  };
}

export async function handleInternalCyclePortalAction(
  request: Request,
  cycleType: InternalCycleType,
): Promise<Response | { saved: true } | { submitted: true } | { withdrawn: true }> {
  const config = INTERNAL_CYCLES[cycleType];
  const showDomainPicker = config.domainStrategy === "target-domains";

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const member = await requireMember(auth.user.sub);
  if (!member) return Response.json({ error: "Not a lab member" }, { status: 403 });

  if (!(await config.eligible(auth.user.sub))) {
    return Response.json({ error: "Not eligible" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const active = await getActiveCycle(cycleType);
  if (!active) return Response.json({ error: "No active cycle" }, { status: 404 });
  if (active.currentStatus !== "Open" && intent !== "withdraw") {
    return Response.json({ error: "Cycle is not open" }, { status: 409 });
  }

  if (intent === "save-draft" || intent === "submit") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: active.id },
      include: {
        shortformVersion: true,
        domains: { select: { domainId: true } },
      },
    });
    if (!cycle.shortformVersionId || !cycle.shortformVersion) {
      return Response.json({ error: "Cycle is not configured" }, { status: 409 });
    }
    const formVersionId = cycle.shortformVersionId;
    const questions = (cycle.shortformVersion.questions as unknown as Question[]) ?? [];
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

    // Upsert the Application (one per user+cycle). Pin the shortform version on
    // create and never re-pin on subsequent saves.
    const application = await prisma.application.upsert({
      where: {
        userId_applicationCycleId: { userId: auth.user.sub, applicationCycleId: active.id },
      },
      update: { answers },
      create: {
        userId: auth.user.sub,
        applicationCycleId: active.id,
        applicationType: cycleType,
        shortformVersionId: formVersionId,
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
