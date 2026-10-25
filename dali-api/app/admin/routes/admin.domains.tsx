import { redirect } from "react-router";
import type { Route } from "./+types/admin.domains";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { ensureDomainGroup } from "~/lib/groups";
import { requireAuth, forbidden } from "~/lib/auth";
import { isAdmin, isCore, currentTerm } from "~/lib/roles";
import { describeDomainUsage, DOMAIN_USAGE_COUNT_SELECT } from "./api.domains.$domainId";
import { parseLevel } from "~/admin/lib/eligibility";
import {
  applyEligibilityWithNotify,
  removeEligibility,
} from "~/admin/lib/eligibility.server";

export const handle = adminHandle("domains");

export const meta: Route.MetaFunction = () => [{ title: "Domains · Admin · DALI OS" }];

// The page itself is Core › Roles & domains (/core/access). This route keeps
// the domain and eligibility action that page forwards to.
export function loader({ request }: Route.LoaderArgs) {
  return redirect(`/core/access${new URL(request.url).search}`);
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub)))
    return forbidden(request);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Domain lifecycle (create/delete) is Admin-only — these mutations touch
  // hiring-cycle state. Lead/eligibility assignments are open to Core.
  const adminOnly = intent === "create-domain" || intent === "delete-domain";
  if (adminOnly && !(await isAdmin(auth.user.sub)))
    return forbidden(request);

  if (intent === "create-domain") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
    // Phase 2: code + displayName required. Derive code from the name by
    // stripping non-alnum (admin can rename later). displayName mirrors
    // name on create; both editable post-create.
    const code = name.replace(/[^A-Za-z0-9]/g, "") || "Domain";
    const domain = await prisma.domain.create({
      data: { name, code, displayName: name },
    });
    await ensureDomainGroup(domain.id, domain.displayName);
    return null;
  }

  if (intent === "delete-domain") {
    const domainId = String(formData.get("domainId") ?? "");
    if (!domainId) return Response.json({ error: "domainId is required" }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const domain = await tx.domain.findUnique({
        where: { id: domainId },
        include: { _count: { select: DOMAIN_USAGE_COUNT_SELECT } },
      });
      if (!domain) return { kind: "not-found" as const };
      const blocking = describeDomainUsage(domain._count);
      if (blocking.length > 0) return { kind: "in-use" as const, blocking };
      await tx.domain.delete({ where: { id: domainId } });
      return { kind: "ok" as const };
    });

    if (result.kind === "not-found") {
      return Response.json({ error: "Domain not found" }, { status: 404 });
    }
    if (result.kind === "in-use") {
      return Response.json(
        { error: `Cannot delete: domain is in use by ${result.blocking.join(", ")}.` },
        { status: 409 },
      );
    }
    return null;
  }

  if (intent === "add-domain-lead") {
    const userId = formData.get("userId") as string;
    const domainId = formData.get("domainId") as string;
    const term = await currentTerm();
    if (!term) {
      return Response.json(
        { error: "No current Term — run npm run db:seed:v0-reference" },
        { status: 500 },
      );
    }
    await prisma.domainLeadAssignment.upsert({
      where: {
        userId_domainId_termId: { userId, domainId, termId: term.id },
      },
      update: {},
      create: { userId, domainId, termId: term.id },
    });
    return null;
  }

  if (intent === "remove-domain-lead") {
    const assignmentId = formData.get("assignmentId") as string;
    await prisma.domainLeadAssignment.delete({ where: { id: assignmentId } });
    return null;
  }

  if (intent === "add-eligibility" || intent === "set-eligibility-level") {
    const userId = String(formData.get("userId") ?? "");
    const domainId = String(formData.get("domainId") ?? "");
    const level = parseLevel(formData.get("level"));
    if (!userId || !domainId || !level) {
      return Response.json({ error: "userId, domainId, and level are required" }, { status: 400 });
    }
    await applyEligibilityWithNotify({ userId, domainId, level, actorId: auth.user.sub });
    return null;
  }

  if (intent === "remove-eligibility") {
    const id = String(formData.get("eligibilityId") ?? "");
    if (!id) return Response.json({ error: "eligibilityId is required" }, { status: 400 });
    await removeEligibility({ id });
    return null;
  }

  return null;
}
