import type { Route } from "./+types/api.cycles.$cycleId.my-availability";
import { prisma } from "~/lib/db";
import { withCors, handlePreflight } from "~/lib/cors";

// Dev fallback: if the logged-in user isn't a DALIMember, use the first
// CycleReviewer for the cycle. Remove once real reviewer auth is wired up.
async function findCycleReviewer(userId: string, cycleId: string) {
  const member = await prisma.dALIMember.findFirst({ where: { userId } });
  if (member) {
    const reviewer = await prisma.cycleReviewer.findUnique({
      where: { daliMemberId_applicationCycleId: { daliMemberId: member.id, applicationCycleId: cycleId } },
    });
    if (reviewer) return reviewer;
  }
  return prisma.cycleReviewer.findFirst({ where: { applicationCycleId: cycleId } });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  // Dev: use first reviewer for the cycle when no auth
  const reviewer = await prisma.cycleReviewer.findFirst({
    where: { applicationCycleId: params.cycleId },
  });
  if (!reviewer) {
    return withCors(request, Response.json([]));
  }

  const blocks = await prisma.reviewerAvailability.findMany({
    where: { cycleReviewerId: reviewer.id },
    orderBy: { startTime: "asc" },
  });

  return withCors(request, Response.json(blocks));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "PUT") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  // Dev: use first reviewer for the cycle when no auth
  const reviewer = await prisma.cycleReviewer.findFirst({
    where: { applicationCycleId: params.cycleId },
  });
  if (!reviewer) {
    return withCors(request, Response.json({ error: "No reviewer found for this cycle" }, { status: 404 }));
  }

  const body = await request.json();
  const blocks: { startTime: string; endTime: string }[] = body.blocks ?? [];

  // Full replacement: delete all existing blocks, create new ones
  await prisma.$transaction([
    prisma.reviewerAvailability.deleteMany({ where: { cycleReviewerId: reviewer.id } }),
    ...blocks.map((b) =>
      prisma.reviewerAvailability.create({
        data: {
          cycleReviewerId: reviewer.id,
          startTime: new Date(b.startTime),
          endTime: new Date(b.endTime),
        },
      }),
    ),
  ]);

  const updated = await prisma.reviewerAvailability.findMany({
    where: { cycleReviewerId: reviewer.id },
    orderBy: { startTime: "asc" },
  });

  return withCors(request, Response.json(updated));
}
