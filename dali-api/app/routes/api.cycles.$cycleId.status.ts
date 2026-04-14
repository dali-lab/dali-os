import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import type { Route } from "./+types/api.cycles.$cycleId.status";

const STATUS_ORDER = ["Draft", "Open", "Closed", "DecisionsReleased"] as const;

export async function loader({ params }: Route.LoaderArgs) {
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

  const { newStatus } = await request.json();
  if (!STATUS_ORDER.includes(newStatus)) {
    return Response.json({ error: "Invalid status" }, { status: 400 });
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
