// Infrastructure project registry management + manual refresh. Save/delete a
// project (Admin) — Fly tokens encrypted at rest; token fields are write-only
// (blank = leave unchanged). Refresh (Core) re-runs the infra-snapshot sweep.

import type { Route } from "./+types/api.infra.registry";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isAdmin } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { deleteInfraProject, saveInfraProject } from "~/lib/infra/registry.server";
import { infraCryptoConfigured } from "~/lib/infra/crypto.server";
import { runJob } from "~/jobs/runner.server";

const Body = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("save"),
    key: z
      .string()
      .min(1)
      .max(48)
      .regex(/^[a-z0-9-]+$/, "lowercase letters, digits, and dashes only"),
    label: z.string().min(1).max(120),
    flyOrgSlug: z.string().max(120).nullable().optional(),
    neonOrgId: z.string().max(120).nullable().optional(),
    enabled: z.boolean(),
    // Write-only. Blank/omitted = leave unchanged; a non-empty value replaces it.
    flyReadToken: z.string().optional(),
    flyWriteToken: z.string().optional(),
  }),
  z.object({ intent: z.literal("delete"), key: z.string() }),
  z.object({ intent: z.literal("refresh") }),
]);

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const parsed = await parseJson(request, Body);
  if (parsed instanceof Response) return parsed;

  // Refresh is the only Core-allowed intent; registry writes require Admin.
  if (parsed.intent !== "refresh" && !(await isAdmin(auth.user.sub))) {
    return forbidden(request);
  }

  if (parsed.intent === "refresh") {
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

  if (parsed.intent === "delete") {
    await deleteInfraProject(parsed.key);
    await logAuditEvent({
      action: "infra.project.delete",
      userId: auth.user.sub,
      targetId: parsed.key,
      request,
    });
    return Response.json({ ok: true });
  }

  // save
  const setsToken = Boolean(parsed.flyReadToken) || Boolean(parsed.flyWriteToken);
  if (setsToken && !infraCryptoConfigured()) {
    return Response.json(
      { error: "INFRA_SECRET_KEY is not configured — cannot store Fly tokens." },
      { status: 400 },
    );
  }
  await saveInfraProject({
    key: parsed.key,
    label: parsed.label,
    flyOrgSlug: parsed.flyOrgSlug ?? null,
    neonOrgId: parsed.neonOrgId ?? null,
    enabled: parsed.enabled,
    // Only pass a token when a non-empty value was provided (else leave as-is).
    ...(parsed.flyReadToken ? { flyReadToken: parsed.flyReadToken } : {}),
    ...(parsed.flyWriteToken ? { flyWriteToken: parsed.flyWriteToken } : {}),
  });
  await logAuditEvent({
    action: "infra.project.save",
    userId: auth.user.sub,
    targetId: parsed.key,
    // Never log token values — only whether they were set on this write.
    metadata: {
      label: parsed.label,
      flyOrgSlug: parsed.flyOrgSlug ?? null,
      neonOrgId: parsed.neonOrgId ?? null,
      enabled: parsed.enabled,
      setFlyReadToken: Boolean(parsed.flyReadToken),
      setFlyWriteToken: Boolean(parsed.flyWriteToken),
    },
    request,
  });
  return Response.json({ ok: true });
}
