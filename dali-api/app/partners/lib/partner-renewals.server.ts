import { prisma } from "~/lib/db.server";
import {
  classifyDecision,
  continueStatusWrites,
  normalizeRoles,
  type NextStepFields,
  nextTerm,
  type RenewalCardModel,
  type RenewalRole,
} from "./partner-renewals";

type TermRef = { id: string; code: string; sortKey: number };

export async function loadRenewalCards(
  pickedTerm: TermRef,
  allTerms: TermRef[],
): Promise<{ decisionTerm: TermRef | null; cards: RenewalCardModel[] }> {
  const decisionTerm = nextTerm(allTerms, pickedTerm.sortKey);
  const projects = await prisma.project.findMany({
    where: { projectTerms: { some: { termId: pickedTerm.id } } },
    select: {
      id: true,
      name: true,
      iconEmoji: true,
      projectTerms: { select: { termId: true } },
      partners: {
        orderBy: { startedAt: "asc" },
        select: { endedAt: true, partnerOrg: { select: { id: true, name: true } } },
      },
    },
  });
  if (!decisionTerm || projects.length === 0) return { decisionTerm, cards: [] };

  const projectIds = projects.map((p) => p.id);
  const laterTermIds = allTerms.filter((t) => t.sortKey >= pickedTerm.sortKey).map((t) => t.id);
  const termById = new Map(allTerms.map((t) => [t.id, t]));
  const orgIds = [...new Set(projects.flatMap((p) => p.partners.map((l) => l.partnerOrg.id)))];

  const [statuses, requests, contacts] = await Promise.all([
    prisma.projectTermStatus.findMany({
      where: { projectId: { in: projectIds }, termId: { in: laterTermIds } },
      select: {
        projectId: true,
        termId: true,
        isContinuing: true,
        feeCents: true,
        reason: true,
        nextStep: true,
        nextStepDueAt: true,
      },
    }),
    prisma.projectRoleRequest.findMany({
      where: { projectId: { in: projectIds }, termId: { in: laterTermIds } },
      select: { projectId: true, termId: true, slots: true, domain: { select: { id: true, displayName: true } } },
    }),
    orgIds.length
      ? prisma.partnerActivity.groupBy({
          by: ["orgId"],
          where: { orgId: { in: orgIds } },
          _max: { createdAt: true },
        })
      : Promise.resolve([] as { orgId: string | null; _max: { createdAt: Date | null } }[]),
  ]);
  const lastByOrg = new Map(contacts.map((c) => [c.orgId, c._max.createdAt]));

  const rolesFor = (projectId: string, termId: string): RenewalRole[] => {
    const merged = new Map<string, RenewalRole>();
    for (const r of requests) {
      if (r.projectId !== projectId || r.termId !== termId) continue;
      const cur = merged.get(r.domain.id);
      if (cur) cur.slots += r.slots;
      else merged.set(r.domain.id, { domainId: r.domain.id, name: r.domain.displayName, slots: r.slots });
    }
    return [...merged.values()];
  };

  const cards = projects.map((p): RenewalCardModel => {
    const mine = statuses.filter((s) => s.projectId === p.id);
    const rows = mine
      .map((s) => ({ s, t: termById.get(s.termId) }))
      .filter((x): x is { s: (typeof mine)[number]; t: TermRef } => !!x.t)
      .filter((x) => x.t.sortKey >= decisionTerm.sortKey)
      .map((x) => ({ sortKey: x.t.sortKey, code: x.t.code, isContinuing: x.s.isContinuing }));
    const verdict = classifyDecision(rows, decisionTerm.sortKey);
    const effectiveTerm = verdict.effectiveCode
      ? allTerms.find((t) => t.code === verdict.effectiveCode)
      : null;
    const decisionRow = mine.find((s) => s.termId === decisionTerm.id);
    const detail = verdict.column === "continuing" && effectiveTerm
      ? mine.find((s) => s.termId === effectiveTerm.id)
      : decisionRow;
    const orgs = p.partners.filter((l) => !l.endedAt);
    const linked = orgs.length ? orgs : p.partners;
    const lastContact = linked
      .map((l) => lastByOrg.get(l.partnerOrg.id) ?? null)
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      projectId: p.id,
      name: p.name,
      iconEmoji: p.iconEmoji,
      orgName: linked[0]?.partnerOrg.name ?? null,
      termCount: p.projectTerms.length,
      column: verdict.column,
      fromTermCode: verdict.fromTermCode,
      nextStep: detail?.nextStep ?? null,
      nextStepDueAt: detail?.nextStepDueAt?.toISOString() ?? null,
      lastContactAt: lastContact?.toISOString() ?? null,
      reason: verdict.column === "not_continuing" ? (decisionRow?.reason ?? null) : null,
      feeCents: detail?.feeCents ?? null,
      lastRoles: rolesFor(p.id, pickedTerm.id),
      decidedRoles: effectiveTerm ? rolesFor(p.id, effectiveTerm.id) : [],
    };
  });
  return { decisionTerm, cards };
}

type Db = typeof prisma;

export async function applyContinue(
  db: Db,
  input: {
    projectId: string;
    decisionTermId: string;
    chosenTermId: string;
    feeCents: number | null;
    roles: { domainId: string; slots: number }[];
    userId: string;
  } & Partial<NextStepFields>,
): Promise<void> {
  const roles = normalizeRoles(input.roles);
  const writes = continueStatusWrites(input.decisionTermId, input.chosenTermId);
  await db.$transaction(async (tx) => {
    for (const w of writes) {
      const isChosen = w.isContinuing;
      const data = {
        isContinuing: w.isContinuing,
        setBy: input.userId,
        setAt: new Date(),
        ...(isChosen
          ? {
              feeCents: input.feeCents,
              reason: null,
              nextStep: input.nextStep ?? null,
              nextStepDueAt: input.nextStepDueAt ?? null,
            }
          : {}),
      };
      await tx.projectTermStatus.upsert({
        where: { projectId_termId: { projectId: input.projectId, termId: w.termId } },
        create: { projectId: input.projectId, termId: w.termId, ...data },
        update: data,
      });
    }
    await tx.projectTerm.upsert({
      where: { projectId_termId: { projectId: input.projectId, termId: input.chosenTermId } },
      create: { projectId: input.projectId, termId: input.chosenTermId },
      update: {},
    });
    await tx.projectRoleRequest.deleteMany({
      where: { projectId: input.projectId, termId: input.chosenTermId },
    });
    if (roles.length) {
      await tx.projectRoleRequest.createMany({
        data: roles.map((r) => ({
          projectId: input.projectId,
          termId: input.chosenTermId,
          domainId: r.domainId,
          level: "P1" as const,
          slots: r.slots,
        })),
      });
    }
  });
}

export async function applyNotContinuing(
  db: Db,
  input: { projectId: string; decisionTermId: string; reason: string; userId: string } & Partial<NextStepFields>,
): Promise<void> {
  const data = {
    isContinuing: false,
    reason: input.reason,
    feeCents: null,
    nextStep: input.nextStep ?? null,
    nextStepDueAt: input.nextStepDueAt ?? null,
    setBy: input.userId,
    setAt: new Date(),
  };
  await db.projectTermStatus.upsert({
    where: { projectId_termId: { projectId: input.projectId, termId: input.decisionTermId } },
    create: { projectId: input.projectId, termId: input.decisionTermId, ...data },
    update: data,
  });
}

export async function applyUndecided(
  db: Db,
  input: { projectId: string; decisionTermId: string; userId?: string } & Partial<NextStepFields>,
): Promise<void> {
  const keepRow = !!input.nextStep;
  const undecidedData = {
    isContinuing: null,
    feeCents: null,
    reason: null,
    nextStep: input.nextStep ?? null,
    nextStepDueAt: input.nextStepDueAt ?? null,
    setBy: input.userId ?? null,
    setAt: new Date(),
  };
  await db.$transaction(async (tx) => {
    const decision = await tx.projectTermStatus.findUnique({
      where: { projectId_termId: { projectId: input.projectId, termId: input.decisionTermId } },
      select: { isContinuing: true, term: { select: { sortKey: true } } },
    });
    if (!decision) {
      if (keepRow) {
        await tx.projectTermStatus.create({
          data: { projectId: input.projectId, termId: input.decisionTermId, ...undecidedData },
        });
      }
      return;
    }
    const toClear = [input.decisionTermId];
    if (!decision.isContinuing) {
      const later = await tx.projectTermStatus.findMany({
        where: {
          projectId: input.projectId,
          isContinuing: true,
          term: { sortKey: { gt: decision.term.sortKey } },
        },
        orderBy: { term: { sortKey: "asc" } },
        take: 1,
        select: { termId: true },
      });
      toClear.push(...later.map((l) => l.termId));
    }
    for (const termId of toClear) {
      const status = await tx.projectTermStatus.findUnique({
        where: { projectId_termId: { projectId: input.projectId, termId } },
        select: { isContinuing: true },
      });
      if (keepRow && termId === input.decisionTermId) {
        await tx.projectTermStatus.update({
          where: { projectId_termId: { projectId: input.projectId, termId } },
          data: undecidedData,
        });
      } else {
        await tx.projectTermStatus.deleteMany({ where: { projectId: input.projectId, termId } });
      }
      if (status?.isContinuing) {
        const assigned = await tx.projectAssignment.count({
          where: { projectId: input.projectId, termId },
        });
        if (assigned === 0) {
          await tx.projectRoleRequest.deleteMany({ where: { projectId: input.projectId, termId } });
        }
      }
    }
  });
}
