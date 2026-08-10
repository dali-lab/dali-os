// Admin control for a feature flag: PATCH { enabled, everyone, roles, userIds,
// note } replaces the flag's targeting. The DB row is authoritative at
// evaluation time (see feature-flags.server.ts), so writes are validated
// against the registry (known key) and ROLE_TARGETS (known role keys).

import type { Route } from "./+types/api.feature-flags.$key";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { isFeatureFlagKey, ROLE_TARGETS } from "~/lib/feature-flags";
import { updateFlag } from "~/lib/feature-flags.server";

const PatchSchema = z.object({
  enabled: z.boolean(),
  everyone: z.boolean(),
  roles: z.array(z.enum(ROLE_TARGETS)),
  userIds: z.array(z.string().min(1)).max(500),
  note: z.string().max(500).nullable().default(null),
});

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.user.sub))) return forbidden(request);

  const key = params.key!;
  if (!isFeatureFlagKey(key)) {
    return Response.json({ error: "Unknown feature flag" }, { status: 404 });
  }
  if (request.method !== "PATCH") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const parsed = await parseJson(request, PatchSchema);
  if (parsed instanceof Response) return parsed;

  await updateFlag(key, parsed);
  await logAuditEvent({
    action: "feature-flags.update",
    userId: auth.user.sub,
    targetId: key,
    metadata: {
      enabled: parsed.enabled,
      everyone: parsed.everyone,
      roles: parsed.roles,
      userCount: parsed.userIds.length,
    },
    request,
  });
  return Response.json({ ok: true });
}
