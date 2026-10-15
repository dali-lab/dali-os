import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import type { Level } from "~/admin/lib/eligibility";
import {
  AdminForbiddenError as McpForbiddenError,
  AdminInvalidError as McpInvalidError,
} from "./errors";
import type { McpCtx } from "../../registry";

const LEVEL_RANK: Record<Level, number> = { P1: 1, P2: 2, P3: 3 };

export const BACKFILL_PROJECT_ASSIGNMENTS_TOOL = {
  name: "backfill_project_assignments",
  description:
    "Write historical ProjectAssignment rows directly, for backfill. Bypasses the staffing cycle: " +
    "no StaffingAssignment rows, no notifications, no mentorship pair derivation. Idempotent " +
    "(re-running updates the level on existing rows). Optionally adds missing ProjectTerm rows and " +
    "raises DomainEligibility to at least each assignment's level; eligibility is never lowered. " +
    "Admins only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      assignments: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: {
          type: "object",
          properties: {
            userId: { type: "string" },
            projectId: { type: "string" },
            termId: { type: "string" },
            domainId: { type: "string" },
            level: { type: "string", enum: ["P1", "P2", "P3"] },
          },
          required: ["userId", "projectId", "termId", "domainId", "level"],
          additionalProperties: false,
        },
      },
      addProjectTerms: {
        type: "boolean",
        default: true,
        description: "Ensure a ProjectTerm row exists for every referenced (projectId, termId).",
      },
      raiseEligibility: {
        type: "boolean",
        default: true,
        description: "Ensure DomainEligibility for (userId, domainId) is at least the assigned level.",
      },
    },
    required: ["assignments"],
    additionalProperties: false,
  },
  requiredScope: "mcp:admin" as const,
};

type Row = { userId: string; projectId: string; termId: string; domainId: string; level: Level };
type Input = { assignments: Row[]; addProjectTerms?: boolean; raiseEligibility?: boolean };

const distinct = (values: string[]) => [...new Set(values)];

export async function runBackfillProjectAssignments(ctx: McpCtx, args: Input) {
  const callerId = ctx.user.id;

  if (!(await isAdmin(callerId))) {
    throw new McpForbiddenError("Only admins can backfill project assignments.");
  }

  const addProjectTerms = args.addProjectTerms ?? true;
  const raiseEligibility = args.raiseEligibility ?? true;

  const byKey = new Map<string, Row>();
  for (const row of args.assignments) {
    byKey.set(`${row.userId}|${row.projectId}|${row.termId}|${row.domainId}`, row);
  }
  const rows = [...byKey.values()];

  const userIds = distinct(rows.map((r) => r.userId));
  const projectIds = distinct(rows.map((r) => r.projectId));
  const termIds = distinct(rows.map((r) => r.termId));
  const domainIds = distinct(rows.map((r) => r.domainId));

  const [users, projects, terms, domains] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true } }),
    prisma.term.findMany({ where: { id: { in: termIds } }, select: { id: true } }),
    prisma.domain.findMany({ where: { id: { in: domainIds } }, select: { id: true } }),
  ]);
  const missing = (kind: string, wanted: string[], found: { id: string }[]) => {
    const have = new Set(found.map((f) => f.id));
    const gone = wanted.filter((id) => !have.has(id));
    return gone.length ? `Unknown ${kind}(s): ${gone.join(", ")}` : null;
  };
  const problems = [
    missing("userId", userIds, users),
    missing("projectId", projectIds, projects),
    missing("termId", termIds, terms),
    missing("domainId", domainIds, domains),
  ].filter((p): p is string => p !== null);
  if (problems.length) throw new McpInvalidError(`${problems.join(". ")}.`);

  const summary = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectAssignment.findMany({
      where: {
        OR: rows.map(({ userId, projectId, termId, domainId }) => ({
          userId,
          projectId,
          termId,
          domainId,
        })),
      },
      select: { userId: true, projectId: true, termId: true, domainId: true },
    });
    const existingKeys = new Set(
      existing.map((e) => `${e.userId}|${e.projectId}|${e.termId}|${e.domainId}`),
    );

    let created = 0;
    let updated = 0;
    for (const row of rows) {
      const key = `${row.userId}|${row.projectId}|${row.termId}|${row.domainId}`;
      if (existingKeys.has(key)) updated++;
      else created++;
      await tx.projectAssignment.upsert({
        where: {
          userId_projectId_termId_domainId: {
            userId: row.userId,
            projectId: row.projectId,
            termId: row.termId,
            domainId: row.domainId,
          },
        },
        update: { level: row.level },
        create: { ...row },
      });
    }

    let projectTermsAdded = 0;
    if (addProjectTerms) {
      const pairs = new Map<string, { projectId: string; termId: string }>();
      for (const { projectId, termId } of rows) {
        pairs.set(`${projectId}|${termId}`, { projectId, termId });
      }
      const res = await tx.projectTerm.createMany({
        data: [...pairs.values()],
        skipDuplicates: true,
      });
      projectTermsAdded = res.count;
    }

    let eligibilityRaised = 0;
    if (raiseEligibility) {
      const wanted = new Map<string, { userId: string; domainId: string; level: Level }>();
      for (const { userId, domainId, level } of rows) {
        const key = `${userId}|${domainId}`;
        const prev = wanted.get(key);
        if (!prev || LEVEL_RANK[level] > LEVEL_RANK[prev.level]) {
          wanted.set(key, { userId, domainId, level });
        }
      }
      const current = await tx.domainEligibility.findMany({
        where: { OR: [...wanted.values()].map(({ userId, domainId }) => ({ userId, domainId })) },
        select: { userId: true, domainId: true, level: true },
      });
      const currentLevel = new Map(current.map((c) => [`${c.userId}|${c.domainId}`, c.level as Level]));
      for (const [key, { userId, domainId, level }] of wanted) {
        const have = currentLevel.get(key);
        if (have && LEVEL_RANK[have] >= LEVEL_RANK[level]) continue;
        await tx.domainEligibility.upsert({
          where: { userId_domainId: { userId, domainId } },
          update: { level, promotedAt: new Date(), promotedBy: callerId },
          create: { userId, domainId, level, promotedBy: callerId },
        });
        eligibilityRaised++;
      }
    }

    return { rows: rows.length, created, updated, projectTermsAdded, eligibilityRaised };
  });

  await logAuditEvent({
    action: "project.assignment.backfill",
    userId: callerId,
    metadata: summary,
    request: ctx.request,
  });

  return { ok: true, ...summary };
}
