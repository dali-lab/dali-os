import type { Route } from "./+types/api.domains.$domainId";
import { prisma } from "~/lib/db.server";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";
import { DOMAIN_USAGE_COUNT_SELECT, describeDomainUsage } from "~/admin/lib/domain-usage";

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return forbidden(request);

  if (request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const domainId = params.domainId!;

  const result = await prisma.$transaction(async (tx) => {
    const domain = await tx.domain.findUnique({
      where: { id: domainId },
      include: { _count: { select: DOMAIN_USAGE_COUNT_SELECT } },
    });

    if (!domain) return { kind: "not-found" as const };

    const blocking = describeDomainUsage(domain._count);
    if (blocking.length > 0) return { kind: "in-use" as const, blocking };

    await tx.domain.delete({ where: { id: domainId } });
    return { kind: "ok" as const, name: domain.name, code: domain.code };
  });

  if (result.kind === "not-found") {
    return withCors(request, Response.json({ error: "Domain not found" }, { status: 404 }));
  }
  if (result.kind === "in-use") {
    return withCors(
          request,
          Response.json(
            { error: `Cannot delete: domain is in use by ${result.blocking.join(", ")}.` },
            { status: 409 },
          ),
        );
  }
  await logAuditEvent({
    action: "domain.delete",
    userId: auth.user.sub,
    targetId: domainId,
    metadata: { name: result.name, code: result.code },
    request,
  });
  return withCors(request, Response.json({ ok: true }));
}
