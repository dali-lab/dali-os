import type { Route } from "./+types/api.domains.$domainId";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

const RELATION_LABELS: Record<string, string> = {
  challengeVersions: "challenge versions",
  applicationCycles: "application cycles",
  domainLeadAssignments: "domain lead assignments",
  cycleReviewers: "cycle reviewers",
  cycleInterviewers: "cycle interviewers",
  delibsSessions: "delibs sessions",
};

export type DomainUsageCounts = {
  challengeVersions: number;
  applicationCycles: number;
  domainLeadAssignments: number;
  cycleReviewers: number;
  cycleInterviewers: number;
  delibsSessions: number;
};

export function describeDomainUsage(counts: DomainUsageCounts): string[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${RELATION_LABELS[key] ?? key}`);
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub)))
    return withAuth(auth, withCors(request, Response.json({ error: "Forbidden" }, { status: 403 })));

  if (request.method !== "DELETE") {
    return withAuth(auth, withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 })));
  }

  const domainId = params.domainId!;

  const result = await prisma.$transaction(async (tx) => {
    const domain = await tx.domain.findUnique({
      where: { id: domainId },
      include: {
        _count: {
          select: {
            challengeVersions: true,
            applicationCycles: true,
            domainLeadAssignments: true,
            cycleReviewers: true,
            cycleInterviewers: true,
            delibsSessions: true,
          },
        },
      },
    });

    if (!domain) return { kind: "not-found" as const };

    const blocking = describeDomainUsage(domain._count);
    if (blocking.length > 0) return { kind: "in-use" as const, blocking };

    await tx.domain.delete({ where: { id: domainId } });
    return { kind: "ok" as const };
  });

  if (result.kind === "not-found") {
    return withAuth(auth, withCors(request, Response.json({ error: "Domain not found" }, { status: 404 })));
  }
  if (result.kind === "in-use") {
    return withAuth(auth, withCors(
          request,
          Response.json(
            { error: `Cannot delete: domain is in use by ${result.blocking.join(", ")}.` },
            { status: 409 },
          ),
        ));
  }
  return withAuth(auth, withCors(request, Response.json({ ok: true })));
}
