import type { Route } from "./+types/api.domains.$domainId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { logAuditEvent } from "~/lib/audit";

const RELATION_LABELS: Record<string, string> = {
  challengeVersions: "challenge versions",
  applicationCycles: "application cycles",
  domainLeadAssignments: "domain lead assignments",
  cycleReviewers: "cycle reviewers",
  cycleInterviewers: "cycle interviewers",
  delibsSessions: "delibs sessions",
  eligibilities: "member eligibilities",
  projectAssignments: "project assignments",
  projects: "project domains",
  projectScopes: "project scopes",
  projectRoleRequests: "project role requests",
  partnerApplicationDomains: "partner applications",
  tasks: "tasks",
  mentorshipPairs: "mentorship pairs",
};

export type DomainUsageCounts = {
  challengeVersions: number;
  applicationCycles: number;
  domainLeadAssignments: number;
  cycleReviewers: number;
  cycleInterviewers: number;
  delibsSessions: number;
  eligibilities: number;
  projectAssignments: number;
  projects: number;
  projectScopes: number;
  projectRoleRequests: number;
  partnerApplicationDomains: number;
  tasks: number;
  mentorshipPairs: number;
};

// Prisma _count select shape — kept here so callers don't repeat it.
export const DOMAIN_USAGE_COUNT_SELECT = {
  challengeVersions: true,
  applicationCycles: true,
  domainLeadAssignments: true,
  cycleReviewers: true,
  cycleInterviewers: true,
  delibsSessions: true,
  eligibilities: true,
  projectAssignments: true,
  projects: true,
  projectScopes: true,
  projectRoleRequests: true,
  partnerApplicationDomains: true,
  tasks: true,
  mentorshipPairs: true,
} as const;

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
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

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
