import { z } from "zod";
import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import type { EventType } from "~/lib/notification-events";
import { parseJson } from "~/lib/validate";
import { requireAuth } from "~/lib/auth";
import { isCore, hasCycleAccess } from "~/lib/roles";
import { autoCloseIfExpired, findOtherActiveCycleId } from "~/hiring/lib/cycles";
import { internalCycleConfig, isInternalCycleType } from "~/hiring/lib/internal-cycles.server";
import { inReviewPipelineFilter } from "~/hiring/lib/application-pipeline-filter";
import { APPLICATION_TZ } from "~/lib/timezone";
import type { Route } from "./+types/api.cycles.$cycleId.status";

const STATUS_ORDER = ["Draft", "Open", "UnderReview", "Completed"] as const;

const StatusUpdateSchema = z.object({
  newStatus: z.enum(STATUS_ORDER),
  force: z.boolean().optional(),
});

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (!(await hasCycleAccess(auth.user.sub, params.cycleId!)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  await autoCloseIfExpired(params.cycleId!);

  const updates = await prisma.applicationCycleStatusUpdate.findMany({
    where: { applicationCycleId: params.cycleId },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  return Response.json({ currentStatus: updates[0]?.newStatus ?? "Draft" });
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const body = await parseJson(request, StatusUpdateSchema);
  if (body instanceof Response) return body;
  const { newStatus, force } = body;

  // Single-active-cycle invariant — enforced *per cycleType*. A Standard hire
  // cycle and an Fellowship conversion cycle may overlap, but two of the
  // same type may not. We look up this cycle's type first so the check is
  // scoped correctly.
  if (newStatus === "Open" || newStatus === "UnderReview") {
    const thisCycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.cycleId! },
      select: { cycleType: true },
    });
    const otherActiveId = await findOtherActiveCycleId(params.cycleId!, thisCycle.cycleType);
    if (otherActiveId) {
      return Response.json(
              {
                error:
                  "Another cycle of the same type is already active. Only one cycle per type can be Open or UnderReview at a time. Move the existing active cycle to Completed first.",
                activeCycleId: otherActiveId,
              },
              { status: 409 },
            );
    }
  }

  // Draft → Open: validate per-cycleType readiness. Standard requires a
  // linked challenge version per domain (challenge-based hiring); Fellowship
  // skips challenges and only requires the shortform to be pinned.
  if (newStatus === "Open") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.cycleId! },
      include: {
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        domains: true,
        challengeVersions: true,
      },
    });

    const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
    if (currentStatus !== "Draft") {
      return Response.json({ error: "Cycle is not in Draft" }, { status: 409 });
    }

    if (!cycle.closeDate) {
      return Response.json({ error: "Close date must be set before opening" }, { status: 400 });
    }

    if (cycle.cycleType === "Standard") {
      const domainIds = new Set(cycle.domains.map((d) => d.domainId));
      // Check that every domain has at least one challenge linked — a legacy
      // ChallengeVersion or a Drive challenge Form (CycleDomainForm).
      if (domainIds.size > 0) {
        const [challengeVersions, challengeForms] = await Promise.all([
          prisma.challengeVersion.findMany({
            where: { applicationCycles: { some: { applicationCycleId: params.cycleId! } } },
            select: { domainId: true },
          }),
          prisma.cycleDomainForm.findMany({
            where: { applicationCycleId: params.cycleId! },
            select: { domainId: true },
          }),
        ]);
        const coveredDomainIds = new Set([
          ...challengeVersions.map((cv) => cv.domainId),
          ...challengeForms.map((cf) => cf.domainId),
        ]);
        for (const domainId of domainIds) {
          if (!coveredDomainIds.has(domainId)) {
            return Response.json(
                        { error: "Every domain must have a challenge linked before opening" },
                        { status: 400 },
                      );
          }
        }
      }
    } else if (isInternalCycleType(cycle.cycleType)) {
      // Internal cycles (Fellowship/Core) skip challenges — only the application
      // form must be bound before opening.
      if (!cycle.applicationFormId) {
        return Response.json(
                { error: "An application form must be bound before opening this cycle" },
                { status: 400 },
              );
      }
    }

    // Every domain must be marked ready by its domain lead (or hiring lead override)
    if (cycle.domains.length === 0 || !cycle.domains.every((d) => d.isReady)) {
      return Response.json(
              { error: "Every domain must be marked ready before opening" },
              { status: 400 },
            );
    }
  }

  // UnderReview → Completed: validate all interviews done and all decisions released
  if (newStatus === "Completed" && !force) {
    const pendingInterviews = await prisma.interview.count({
      where: { applicationCycleId: params.cycleId!, status: "Scheduled" },
    });
    const undecided = await prisma.domainApplication.count({
      where: {
        selected: true,
        application: { applicationCycleId: params.cycleId!, ...inReviewPipelineFilter },
        decisions: {
          none: { stage: "Released", type: { in: ["Accepted", "Waitlisted", "Rejected"] } },
        },
      },
    });
    if (pendingInterviews > 0 || undecided > 0) {
      return Response.json(
              {
                error: "Not all work is complete. Use force completion to override.",
                pendingInterviews,
                undecidedApplications: undecided,
              },
              { status: 409 },
            );
    }
  }

  // For internal (Fellowship/Core) cycles opening for the first time, prepare
  // the notification fan-out. We pre-compute the recipient list outside the
  // transaction (it's a pure read), then commit the status transition,
  // notification rows, and idempotency marker atomically. The
  // applicantsNotifiedAt flag guards against re-spam if the lead later bounces
  // Open→Draft→Open during setup. Copy + recipient set + event come from the
  // internal-cycle registry.
  let fanOutPlan: {
    userIds: string[];
    eventType: EventType;
    title: string;
    body: string;
    link: string;
  } | null = null;
  if (newStatus === "Open") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.cycleId! },
      select: { cycleType: true, closeDate: true, name: true, applicantsNotifiedAt: true },
    });
    const config = internalCycleConfig(cycle.cycleType);
    if (config && !cycle.applicantsNotifiedAt) {
      const userIds = await config.eligibleUserIds();
      const closeText = cycle.closeDate
        ? ` Apply by ${cycle.closeDate.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: APPLICATION_TZ })}.`
        : "";
      fanOutPlan = {
        userIds,
        eventType: config.openInvite.eventType,
        title: config.openInvite.title(cycle.name),
        body: config.openInvite.body(cycle.name, closeText),
        link: config.openInvite.link,
      };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.applicationCycleStatusUpdate.create({
      data: {
        applicationCycleId: params.cycleId!,
        newStatus,
        userId: auth.user.sub,
      },
    });

    if (fanOutPlan) {
      await tx.applicationCycle.update({
        where: { id: params.cycleId! },
        data: { applicantsNotifiedAt: new Date() },
      });
    }
  });

  // Fan out after commit, best-effort (matching the interview-notifications
  // convention: a flaky notification write must not roll back a committed
  // status change). applicantsNotifiedAt is already set, so a crash between
  // commit and fan-out drops the batch rather than re-spamming on retry.
  if (fanOutPlan && fanOutPlan.userIds.length > 0) {
    await notify({
      eventType: fanOutPlan.eventType,
      createdByUserId: auth.user.sub,
      message: {
        title: fanOutPlan.title,
        body: fanOutPlan.body,
        link: fanOutPlan.link,
      },
      recipients: fanOutPlan.userIds.map((userId) => ({ userId })),
    }).catch((err) => console.error("[cycle-status] internal-cycle fan-out failed:", err));
  }

  return Response.json({ currentStatus: newStatus });
}
