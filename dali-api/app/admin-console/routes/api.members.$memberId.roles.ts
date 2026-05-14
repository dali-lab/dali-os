import type { Route } from "./+types/api.members.$memberId.roles";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, currentTerm } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";

// Phase 2: PATCH body is a desired-set of legacy role labels. We translate:
//   - "Admin"      → AdminMembership row (created/deleted)
//   - "HiringLead" → CoreAssignment row with leadTitle="Hiring Lead" for the
//                    current term (created/deleted)
// `memberId` in the route param is now the User.id (renamed semantically).

const MEMBER_ROLES = ["Admin", "HiringLead"] as const;
type LegacyRole = (typeof MEMBER_ROLES)[number];

const RolesPatchSchema = z.object({
  roles: z.array(z.enum(MEMBER_ROLES)).max(MEMBER_ROLES.length),
});

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isAdmin(auth.user.sub))) return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));

  if (request.method !== "PATCH") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, RolesPatchSchema);
  if (body instanceof Response) return withCors(request, body);
  const { roles } = body;
  const userId = params.memberId!;

  const term = await currentTerm();
  if (!term) {
    return withCors(
      request,
      Response.json(
        { error: "No current Term — run npm run db:seed:v0-reference" },
        { status: 500 },
      ),
    );
  }

  // Before-snapshot for audit.
  const [adminBefore, coreBefore] = await Promise.all([
    prisma.adminMembership.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.coreAssignment.findFirst({
      where: { userId, termId: term.id, leadTitle: "Hiring Lead" },
      select: { id: true },
    }),
  ]);
  const before: LegacyRole[] = [
    ...(adminBefore ? (["Admin"] as const) : []),
    ...(coreBefore ? (["HiringLead"] as const) : []),
  ];

  const wantAdmin = roles.includes("Admin");
  const wantHiringLead = roles.includes("HiringLead");

  await prisma.$transaction(async (tx) => {
    if (wantAdmin) {
      await tx.adminMembership.upsert({
        where: { userId },
        update: {},
        create: { userId, grantedBy: auth.user.sub },
      });
    } else {
      await tx.adminMembership.deleteMany({ where: { userId } });
    }

    if (wantHiringLead) {
      const exists = await tx.coreAssignment.findFirst({
        where: { userId, termId: term.id, leadTitle: "Hiring Lead" },
        select: { id: true },
      });
      if (!exists) {
        await tx.coreAssignment.create({
          data: { userId, termId: term.id, leadTitle: "Hiring Lead" },
        });
      }
    } else {
      await tx.coreAssignment.deleteMany({
        where: { userId, termId: term.id, leadTitle: "Hiring Lead" },
      });
    }
  });

  await logAuditEvent({
    action: "role.change",
    userId: auth.user.sub,
    targetId: userId,
    metadata: { before, after: roles, targetUserId: userId },
    request,
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      adminMembership: { select: { id: true } },
      coreAssignments: {
        where: { termId: term.id },
        select: { leadTitle: true },
      },
    },
  });

  return withCors(request, Response.json(user));
}
