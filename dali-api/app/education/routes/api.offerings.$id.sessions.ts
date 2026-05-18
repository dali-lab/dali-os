import type { Route } from "./+types/api.offerings.$id.sessions";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { syncSessionRoster } from "~/lib/education/roster-sync";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const offeringId = params.id!;
  const gate = await requireEducationManager(request, offeringId);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as {
    datetime: string;
    location?: string | null;
    sequence?: number;
  };
  const max = await prisma.educationSession.aggregate({
    where: { offeringId },
    _max: { sequence: true },
  });
  const session = await prisma.educationSession.create({
    data: {
      offeringId,
      sequence: body.sequence ?? (max._max.sequence ?? 0) + 1,
      datetime: new Date(body.datetime),
      location: body.location ?? null,
    },
  });
  // Fire-and-forget: if there's already an approved roster, create the
  // calendar event for the new session.
  syncSessionRoster(offeringId).catch((err) => {
    console.error("[education:sessions] post-create sync failed", err);
  });
  return Response.json({ session }, { status: 201 });
}
