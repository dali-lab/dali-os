import type { Route } from "./+types/api.decisions.$id.start-term";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { setApplicationStartTerm } from "~/hiring/lib/start-terms.server";

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!(await isCore(auth.user.sub))) {
    return Response.json({ error: "Only hiring leads can set a start term" }, { status: 403 });
  }

  const decision = await prisma.decision.findUnique({
    where: { id: params.id },
    select: {
      domainApplication: {
        select: { application: { select: { userId: true, applicationCycleId: true } } },
      },
    },
  });
  if (!decision) return Response.json({ error: "Decision not found" }, { status: 404 });
  const { userId, applicationCycleId } = decision.domainApplication.application;

  const gate = await requireApiSignedOrForbidden(auth.user.sub, applicationCycleId);
  if (gate) return gate;

  const form = await request.formData();
  const result = await setApplicationStartTerm({
    userId,
    cycleId: applicationCycleId,
    termId: String(form.get("termId") ?? ""),
    actorId: auth.user.sub,
    request,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ startTermId: result.startTermId });
}
