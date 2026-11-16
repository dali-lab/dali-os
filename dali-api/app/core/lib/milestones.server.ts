import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { coreCycleTermIds } from "~/lib/core-cycle.server";
import { personName } from "~/lib/core-members.server";
import {
  isValidWeek,
  renumber,
  reorder,
  sameSeasonLastYear,
  type MilestoneItem,
  type MilestoneKind,
} from "~/core/lib/milestones";

export class MilestoneError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "MilestoneError";
  }
}

type Actor = { userId: string; request?: Request };

const OWNER_SELECT = {
  owners: {
    select: { user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } } },
  },
} as const;

type Row = {
  id: string;
  week: number;
  kind: MilestoneKind;
  title: string;
  notes: string | null;
  position: number;
  owners: { user: { id: string; firstName: string | null; lastName: string | null; daliEmail: string | null } }[];
};

function toItem(r: Row): MilestoneItem {
  return {
    id: r.id,
    week: r.week,
    kind: r.kind,
    title: r.title,
    notes: r.notes,
    position: r.position,
    owners: r.owners.map((o) => ({ id: o.user.id, name: personName(o.user) })),
  };
}

const ORDER = [{ position: "asc" }, { createdAt: "asc" }] as const;

async function listItems(termId: string): Promise<MilestoneItem[]> {
  const rows = await prisma.coreMilestone.findMany({
    where: { termId },
    orderBy: [{ week: "asc" }, ...ORDER],
    select: {
      id: true,
      week: true,
      kind: true,
      title: true,
      notes: true,
      position: true,
      ...OWNER_SELECT,
    },
  });
  return (rows as unknown as Row[]).map(toItem);
}

export async function findLastYearTerm(termId: string) {
  const term = await prisma.term.findUnique({
    where: { id: termId },
    select: { id: true, code: true, year: true, season: true },
  });
  if (!term) return { term: null, lastYear: null };
  const candidates = await prisma.term.findMany({
    where: { season: term.season, year: term.year - 1 },
    select: { id: true, code: true, year: true, season: true },
  });
  return { term, lastYear: sameSeasonLastYear(term, candidates) };
}

export async function getTermMilestones(termId: string) {
  const { lastYear } = await findLastYearTerm(termId);
  const [items, lastYearItems] = await Promise.all([
    listItems(termId),
    lastYear ? listItems(lastYear.id) : Promise.resolve([] as MilestoneItem[]),
  ]);
  return { items, lastYear: lastYear ? { id: lastYear.id, code: lastYear.code } : null, lastYearItems };
}

export async function listCoreMembersForTerm(termId: string) {
  const termIds = await coreCycleTermIds(termId);
  const rows = await prisma.coreAssignment.findMany({
    where: { termId: { in: [...termIds, termId] } },
    select: { userId: true, user: { select: { firstName: true, lastName: true, daliEmail: true } } },
    distinct: ["userId"],
  });
  return rows
    .map((r) => ({ id: r.userId, name: personName(r.user) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function assertOwners(termId: string, ownerIds: string[]): Promise<string[]> {
  const unique = [...new Set(ownerIds)];
  if (unique.length === 0) return [];
  const termIds = await coreCycleTermIds(termId);
  const rows = await prisma.coreAssignment.findMany({
    where: { userId: { in: unique }, termId: { in: [...termIds, termId] } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (rows.length !== unique.length) throw new MilestoneError("Owners must be current Core members");
  return unique;
}

function cleanNotes(notes: string | null | undefined): string | null {
  const trimmed = notes?.trim();
  return trimmed ? trimmed : null;
}

async function sectionIds(
  tx: Pick<typeof prisma, "coreMilestone">,
  termId: string,
  week: number,
  kind: MilestoneKind,
) {
  return tx.coreMilestone.findMany({
    where: { termId, week, kind },
    orderBy: [...ORDER],
    select: { id: true },
  });
}

async function writePositions(tx: Pick<typeof prisma, "coreMilestone">, ids: { id: string }[]) {
  for (const { id, position } of renumber(ids)) {
    await tx.coreMilestone.update({ where: { id }, data: { position } });
  }
}

export async function createMilestone(
  input: {
    termId: string;
    week: number;
    kind?: MilestoneKind;
    title: string;
    notes?: string | null;
    ownerIds?: string[];
  },
  actor: Actor,
) {
  if (!isValidWeek(input.week)) throw new MilestoneError("Week must be between 0 and 10");
  const title = input.title.trim();
  if (!title) throw new MilestoneError("Title is required");
  const term = await prisma.term.findUnique({ where: { id: input.termId }, select: { id: true } });
  if (!term) throw new MilestoneError("Term not found", 404);
  const kind = input.kind ?? "Milestone";
  const ownerIds = await assertOwners(input.termId, input.ownerIds ?? []);
  const last = await prisma.coreMilestone.findFirst({
    where: { termId: input.termId, week: input.week, kind },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const created = await prisma.coreMilestone.create({
    data: {
      termId: input.termId,
      week: input.week,
      kind,
      title,
      notes: cleanNotes(input.notes),
      position: last ? last.position + 1 : 0,
      owners: { create: ownerIds.map((userId) => ({ userId })) },
    },
    select: { id: true, week: true, kind: true, title: true, notes: true, position: true, ...OWNER_SELECT },
  });
  await logAuditEvent({
    action: "core.milestone.create",
    userId: actor.userId,
    targetId: created.id,
    request: actor.request,
    metadata: { termId: input.termId, week: input.week, kind },
  });
  return toItem(created as unknown as Row);
}

export async function updateMilestone(
  input: { id: string; title?: string; notes?: string | null; ownerIds?: string[]; kind?: MilestoneKind },
  actor: Actor,
): Promise<{ deleted: true } | { deleted: false; item: MilestoneItem }> {
  const existing = await prisma.coreMilestone.findUnique({
    where: { id: input.id },
    select: { id: true, termId: true, week: true, kind: true },
  });
  if (!existing) throw new MilestoneError("Milestone not found", 404);

  if (input.title !== undefined && !input.title.trim()) {
    await deleteMilestone(input.id, actor);
    return { deleted: true };
  }

  const ownerIds = input.ownerIds ? await assertOwners(existing.termId, input.ownerIds) : null;
  const kindChanged = input.kind !== undefined && input.kind !== existing.kind;

  const row = await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.notes !== undefined) data.notes = cleanNotes(input.notes);
    if (ownerIds) {
      await tx.coreMilestoneOwner.deleteMany({ where: { milestoneId: existing.id } });
      data.owners = { create: ownerIds.map((userId) => ({ userId })) };
    }
    if (kindChanged) {
      const target = await sectionIds(tx, existing.termId, existing.week, input.kind!);
      data.kind = input.kind;
      data.position = target.length;
    }
    const updated = await tx.coreMilestone.update({
      where: { id: existing.id },
      data,
      select: { id: true, week: true, kind: true, title: true, notes: true, position: true, ...OWNER_SELECT },
    });
    if (kindChanged) {
      await writePositions(tx, await sectionIds(tx, existing.termId, existing.week, existing.kind));
    }
    return updated;
  });

  await logAuditEvent({
    action: "core.milestone.update",
    userId: actor.userId,
    targetId: existing.id,
    request: actor.request,
    metadata: { fields: Object.keys(input).filter((k) => k !== "id") },
  });
  return { deleted: false, item: toItem(row as unknown as Row) };
}

export async function moveMilestone(
  input: { id: string; toWeek: number; toPosition?: number; termId?: string },
  actor: Actor,
) {
  if (!isValidWeek(input.toWeek)) throw new MilestoneError("Week must be between 0 and 10");
  const existing = await prisma.coreMilestone.findUnique({
    where: { id: input.id },
    select: { id: true, termId: true, week: true, kind: true },
  });
  if (!existing) throw new MilestoneError("Milestone not found", 404);
  if (input.termId && input.termId !== existing.termId) {
    throw new MilestoneError("A milestone can only move within its term");
  }

  await prisma.$transaction(async (tx) => {
    const sameWeek = input.toWeek === existing.week;
    const target = (await sectionIds(tx, existing.termId, input.toWeek, existing.kind)).filter(
      (i) => i.id !== existing.id,
    );
    const toIndex = input.toPosition ?? target.length;
    const withMoved = reorder([...target, { id: existing.id }], existing.id, toIndex);
    if (!sameWeek) {
      await tx.coreMilestone.update({ where: { id: existing.id }, data: { week: input.toWeek } });
    }
    await writePositions(tx, withMoved);
    if (!sameWeek) {
      await writePositions(tx, await sectionIds(tx, existing.termId, existing.week, existing.kind));
    }
  });

  await logAuditEvent({
    action: "core.milestone.move",
    userId: actor.userId,
    targetId: existing.id,
    request: actor.request,
    metadata: { fromWeek: existing.week, toWeek: input.toWeek },
  });
  return listItems(existing.termId);
}

export async function deleteMilestone(id: string, actor: Actor) {
  const existing = await prisma.coreMilestone.findUnique({
    where: { id },
    select: { id: true, termId: true, week: true, kind: true },
  });
  if (!existing) throw new MilestoneError("Milestone not found", 404);
  await prisma.$transaction(async (tx) => {
    await tx.coreMilestone.delete({ where: { id } });
    await writePositions(tx, await sectionIds(tx, existing.termId, existing.week, existing.kind));
  });
  await logAuditEvent({
    action: "core.milestone.delete",
    userId: actor.userId,
    targetId: id,
    request: actor.request,
    metadata: { termId: existing.termId, week: existing.week, kind: existing.kind },
  });
}

export async function fillTermFromLastYear(termId: string, actor: Actor) {
  const { term, lastYear } = await findLastYearTerm(termId);
  if (!term) throw new MilestoneError("Term not found", 404);
  if (!lastYear) throw new MilestoneError("There is no term from last year to copy");

  const [source, current] = await Promise.all([
    prisma.coreMilestone.findMany({
      where: { termId: lastYear.id },
      orderBy: [{ week: "asc" }, ...ORDER],
      select: { week: true, kind: true, title: true, position: true, owners: { select: { userId: true } } },
    }),
    prisma.coreMilestone.findMany({ where: { termId }, select: { week: true }, distinct: ["week"] }),
  ]);
  const taken = new Set(current.map((c) => c.week));
  const toCopy = source.filter((s) => !taken.has(s.week));
  if (toCopy.length === 0) return { copied: 0 };

  const coreIds = new Set(
    (
      await prisma.coreAssignment.findMany({
        where: { termId: { in: await coreCycleTermIds(termId) } },
        select: { userId: true },
      })
    ).map((a) => a.userId),
  );
  const counters = new Map<string, number>();
  await prisma.$transaction(async (tx) => {
    for (const s of toCopy) {
      const key = `${s.week}:${s.kind}`;
      const position = counters.get(key) ?? 0;
      counters.set(key, position + 1);
      await tx.coreMilestone.create({
        data: {
          termId,
          week: s.week,
          kind: s.kind,
          title: s.title,
          position,
          owners: {
            create: s.owners.filter((o) => coreIds.has(o.userId)).map((o) => ({ userId: o.userId })),
          },
        },
      });
    }
  });
  await logAuditEvent({
    action: "core.milestone.fill",
    userId: actor.userId,
    targetId: termId,
    request: actor.request,
    metadata: { fromTermId: lastYear.id, copied: toCopy.length },
  });
  return { copied: toCopy.length };
}
