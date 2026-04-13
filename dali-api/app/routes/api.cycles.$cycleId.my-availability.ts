import type { Route } from "./+types/api.cycles.$cycleId.my-availability";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

async function findCycleReviewer(userId: string, cycleId: string) {
  const member = await prisma.dALIMember.findFirst({ where: { userId } });
  if (!member) return null;
  return prisma.cycleReviewer.findFirst({
    where: { daliMemberId: member.id, applicationCycleId: cycleId },
  });
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const reviewer = await findCycleReviewer(auth.user.sub, params.cycleId!);
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

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const reviewer = await findCycleReviewer(auth.user.sub, params.cycleId!);
  if (!reviewer) {
    return withCors(request, Response.json({ error: "Not a reviewer for this cycle" }, { status: 404 }));
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
