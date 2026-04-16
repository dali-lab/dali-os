import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { findOtherActiveCycleId } from "~/lib/cycles";
import type { Route } from "./+types/api.cycles.$cycleId.status";

const STATUS_ORDER = ["Draft", "Open", "UnderReview", "Completed"] as const;

// Lazily auto-close a cycle that has passed its closeDate.
async function maybeAutoClose(cycleId: string) {
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!cycle) return;

  const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
  if (currentStatus !== "Open") return;
  if (!cycle.closeDate || new Date() <= cycle.closeDate) return;

  // Check+insert inside a transaction to avoid duplicate auto-close rows
  await prisma.$transaction(async (tx) => {
    const alreadyClosed = await tx.applicationCycleStatusUpdate.findFirst({
      where: { applicationCycleId: cycleId, newStatus: "UnderReview" },
    });
    if (!alreadyClosed) {
      await tx.applicationCycleStatusUpdate.create({
        data: { applicationCycleId: cycleId, newStatus: "UnderReview", userId: null },
      });
    }
  });
}

export async function loader({ params }: Route.LoaderArgs) {
  await maybeAutoClose(params.cycleId!);

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
  if (!(await isHiringLead(auth.user.sub))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });

  const { newStatus, force } = await request.json();
  if (!STATUS_ORDER.includes(newStatus)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
  }

  // Single-active-cycle invariant: only one cycle can be Open or UnderReview at a time.
  if (newStatus === "Open" || newStatus === "UnderReview") {
    const otherActiveId = await findOtherActiveCycleId(params.cycleId!);
    if (otherActiveId) {
      return Response.json(
        {
          error:
            "Another cycle is already active. Only one cycle can be Open or UnderReview at a time. Move the existing active cycle to Completed first.",
          activeCycleId: otherActiveId,
        },
        { status: 409 },
      );
    }
  }

  // Draft → Open requires closeDate and every domain having a linked challenge version
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

    const domainIds = new Set(cycle.domains.map((d) => d.domainId));
    const coveredDomains = new Set(
      cycle.challengeVersions.map((cv) => cv.challengeVersionId),
    );
    // Check that every domain has at least one challenge version linked
    if (domainIds.size > 0) {
      const challengeVersions = await prisma.challengeVersion.findMany({
        where: { applicationCycles: { some: { applicationCycleId: params.cycleId! } } },
        select: { domainId: true },
      });
      const coveredDomainIds = new Set(challengeVersions.map((cv) => cv.domainId));
      for (const domainId of domainIds) {
        if (!coveredDomainIds.has(domainId)) {
          return Response.json(
            { error: "Every domain must have a challenge version linked before opening" },
            { status: 400 },
          );
        }
      }
    }
  }

  // UnderReview → Completed: validate all interviews done and all decisions released
  if (newStatus === "Completed" && !force) {
    const pendingInterviews = await prisma.interview.count({
      where: { applicationCycleId: params.cycleId!, status: { not: "Completed" } },
    });
    const undecided = await prisma.domainApplication.count({
      where: {
        application: { applicationCycleId: params.cycleId! },
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

  await prisma.applicationCycleStatusUpdate.create({
    data: {
      applicationCycleId: params.cycleId!,
      newStatus,
      userId: auth.user.sub,
    },
  });

  return Response.json({ currentStatus: newStatus });
}
