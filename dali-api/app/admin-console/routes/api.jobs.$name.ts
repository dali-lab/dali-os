// Admin controls for a background job: PATCH { enabled } toggles it,
// POST { action: "run" } force-runs it (respecting the in-flight lease).

import type { Route } from "./+types/api.jobs.$name";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { jobByName } from "~/jobs/registry";
import { runJob } from "~/jobs/runner.server";

const PatchSchema = z.object({ enabled: z.boolean() });
const PostSchema = z.object({ action: z.literal("run") });

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.user.sub))) return forbidden(request);

  const name = params.name!;
  if (!jobByName(name)) {
    return Response.json({ error: "Unknown job" }, { status: 404 });
  }

  if (request.method === "PATCH") {
    const parsed = await parseJson(request, PatchSchema);
    if (parsed instanceof Response) return parsed;

    await prisma.scheduledJob.update({
      where: { name },
      data: { enabled: parsed.enabled },
    });
    await logAuditEvent({
      action: "jobs.toggle",
      userId: auth.user.sub,
      targetId: name,
      metadata: { enabled: parsed.enabled },
      request,
    });
    return Response.json({ ok: true, enabled: parsed.enabled });
  }

  if (request.method === "POST") {
    const parsed = await parseJson(request, PostSchema);
    if (parsed instanceof Response) return parsed;

    const result = await runJob(name, { force: true });
    await logAuditEvent({
      action: "jobs.run",
      userId: auth.user.sub,
      targetId: name,
      metadata: { ran: result.ran, error: result.error ?? null },
      request,
    });
    if (!result.ran) {
      return Response.json({ ok: false, error: result.error }, { status: 409 });
    }
    return Response.json({ ok: true, error: result.error ?? null });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
