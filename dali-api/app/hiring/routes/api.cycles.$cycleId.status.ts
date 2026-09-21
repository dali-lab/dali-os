import { z } from "zod";
import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import type { EventType } from "~/lib/notification-events";
import { parseJson } from "~/lib/validate";
import { requireAuth } from "~/lib/auth";
import { isCycleAdmin, hasCycleAccess } from "~/lib/roles";
import { autoCloseIfExpired } from "~/hiring/lib/cycles";
import { applicantGroup, isMemberApplicants } from "~/hiring/lib/applicant-groups.server";
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
  if (!(await isCycleAdmin(auth.user.sub, params.cycleId!))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const body = await parseJson(request, StatusUpdateSchema);
  if (body instanceof Response) return body;
  const { newStatus, force } = body;

  // Draft → Open: validate readiness. A cycle with challenges needs one linked
  // per domain; member-authed cycles (and any cycle without challenges) need
  // the application form bound, since that's all the applicant fills in.
  if (newStatus === "Open") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.cycleId! },
      include: {
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        domains: true,
      },
    });

    const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
    if (currentStatus !== "Draft") {
      return Response.json({ error: "Cycle is not in Draft" }, { status: 409 });
    }

    if (!cycle.closeDate) {
      return Response.json({ error: "Close date must be set before opening" }, { status: 400 });
    }

    if (cycle.hasChallenges) {
      const domainIds = new Set(cycle.domains.map((d) => d.domainId));
      // Check that every domain has at least one challenge Form linked.
      if (domainIds.size > 0) {
        const challengeForms = await prisma.cycleDomainForm.findMany({
          where: { applicationCycleId: params.cycleId! },
          select: { domainId: true },
        });
        const coveredDomainIds = new Set(challengeForms.map((cf) => cf.domainId));
        for (const domainId of domainIds) {
          if (!coveredDomainIds.has(domainId)) {
            return Response.json(
                        { error: "Every domain must have a challenge linked before opening" },
                        { status: 400 },
                      );
          }
        }
      }
    }
    if ((!cycle.hasChallenges || isMemberApplicants(cycle.applicants)) && !cycle.applicationFormId) {
      return Response.json(
              { error: "An application form must be bound before opening this cycle" },
              { status: 400 },
            );
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

  // For member-authed cycles (Interns/Lab members) opening for the first time, prepare
  // the notification fan-out. We pre-compute the recipient list outside the
  // transaction (it's a pure read), then commit the status transition,
  // notification rows, and idempotency marker atomically. The
  // applicantsNotifiedAt flag guards against re-spam if the lead later bounces
  // Open→Draft→Open during setup. Copy + recipient set + event come from the
  // applicant-group registry.
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
      select: { applicants: true, closeDate: true, name: true, applicantsNotifiedAt: true },
    });
    const config = applicantGroup(cycle.applicants, params.cycleId!);
    if (config.openInvite && config.eligibleUserIds && !cycle.applicantsNotifiedAt) {
      const userIds = await config.eligibleUserIds();
      const closeText = cycle.closeDate
        ? ` Apply by ${cycle.closeDate.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: APPLICATION_TZ })}.`
        : "";
      fanOutPlan = {
        userIds,
        eventType: config.openInvite.eventType,
        title: config.openInvite.title(cycle.name),
        body: config.openInvite.body(cycle.name, closeText),
        link: config.portalPath,
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
    }).catch((err) => console.error("[cycle-status] open fan-out failed:", err));
  }

  return Response.json({ currentStatus: newStatus });
}
