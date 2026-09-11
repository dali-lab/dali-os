// Manual refresh of the infra-snapshot sweep (Core). Project infra CONFIG now
// lives on the Project row and is edited in the project hub's Details card, so
// this route no longer manages a registry — it just re-runs the sweep on demand.

import type { Route } from "./+types/api.infra.registry";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { runJob } from "~/jobs/runner.server";

const Body = z.object({ intent: z.literal("refresh") });

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const parsed = await parseJson(request, Body);
  if (parsed instanceof Response) return parsed;

  const result = await runJob("infra-snapshot", { force: true });
  await logAuditEvent({
    action: "infra.refresh",
    userId: auth.user.sub,
    metadata: { ran: result.ran, error: result.error ?? null },
    request,
  });
  if (!result.ran) return Response.json({ ok: false, error: result.error }, { status: 409 });
  return Response.json({ ok: true });
}
