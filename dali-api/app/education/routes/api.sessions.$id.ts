import type { Route } from "./+types/api.sessions.$id";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { syncSessionRoster } from "~/lib/education/roster-sync";

export async function action({ request, params }: Route.ActionArgs) {
  const id = params.id!;
  const existing = await prisma.educationSession.findUnique({
    where: { id },
    select: { offeringId: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireEducationManager(request, existing.offeringId);
  if (!gate.ok) return gate.response;

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = (await request.json()) as Partial<{
      datetime: string;
      location: string | null;
      recordingUrl: string | null;
    }>;
    const session = await prisma.educationSession.update({
      where: { id },
      data: {
        ...(body.datetime ? { datetime: new Date(body.datetime) } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.recordingUrl !== undefined ? { recordingUrl: body.recordingUrl } : {}),
      },
    });
    if (body.datetime) {
      syncSessionRoster(existing.offeringId).catch((err) => {
        console.error("[education:sessions] post-update sync failed", err);
      });
    }
    return Response.json({ session });
  }
  if (request.method === "DELETE") {
    await prisma.educationSession.delete({ where: { id } });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
