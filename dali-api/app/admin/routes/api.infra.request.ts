// Infra change requests. Submit: staffed members (or Core) ask for a change to a
// project's infra (core || isProjectMember). Resolve: Core/Admin mark a request
// Fulfilled/Rejected (after performing the change in the fleet console).

import type { Route } from "./+types/api.infra.request";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isProjectMember } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { createInfraRequest, resolveInfraRequest } from "~/lib/infra/requests.server";

const Body = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("submit"),
    projectId: z.string(),
    kind: z.enum(["provision_database", "scale_compute", "adjust_limits", "other"]),
    details: z.string().min(1).max(2000),
    targetHint: z.string().max(200).optional(),
  }),
  z.object({
    intent: z.literal("resolve"),
    requestId: z.string(),
    status: z.enum(["Fulfilled", "Rejected"]),
    note: z.string().max(2000).optional(),
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const parsed = await parseJson(request, Body);
  if (parsed instanceof Response) return parsed;

  if (parsed.intent === "submit") {
    const core = await isCore(auth.user.sub);
    if (!core && !(await isProjectMember(auth.user.sub, parsed.projectId))) {
      return forbidden(request);
    }
    const id = await createInfraRequest({
      projectId: parsed.projectId,
      requestedByUserId: auth.user.sub,
      kind: parsed.kind,
      details: parsed.details,
      targetHint: parsed.targetHint ?? null,
    });
    await logAuditEvent({
      action: "infra.request.create",
      userId: auth.user.sub,
      targetId: id,
      metadata: { projectId: parsed.projectId, kind: parsed.kind },
      request,
    });
    return Response.json({ ok: true, id });
  }

  // resolve — Core/Admin only
  if (!(await isCore(auth.user.sub))) return forbidden(request);
  await resolveInfraRequest({
    requestId: parsed.requestId,
    resolvedByUserId: auth.user.sub,
    status: parsed.status,
    note: parsed.note ?? null,
  });
  await logAuditEvent({
    action: "infra.request.resolve",
    userId: auth.user.sub,
    targetId: parsed.requestId,
    metadata: { status: parsed.status },
    request,
  });
  return Response.json({ ok: true });
}
