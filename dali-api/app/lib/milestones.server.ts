// Server-side data layer for milestone sets: lazy seed of the Lab set, listing,
// versioning (FormVersion-style append + lock-on-use), and draft save. Pulls in
// node-only deps (loadTimeline → node:crypto) so it must stay .server-only —
// never import from a client bundle. Shared types live in ~/lib/milestones.
// See specs/milestones.md.

import { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db";
import { loadTimeline } from "~/lib/term-timeline.server";
import { coerceEntries, type MilestoneEntry } from "~/lib/milestones";

const LAB_DEFAULT_SET_NAME = "Lab default";

// ─── Locking (mirrors isFormVersionLocked) ───────────────────────────────────

/** A version is locked once any project pins it via a ProjectMilestoneAssignment. */
export async function isMilestoneVersionLocked(versionId: string): Promise<boolean> {
  const pin = await prisma.projectMilestoneAssignment.findFirst({
    where: { versionId },
    select: { projectId: true },
  });
  return pin !== null;
}

/** Batch lock-state for every version of a set (mirrors lockedVersionIds). */
export async function lockedMilestoneVersionIds(setId: string): Promise<Set<string>> {
  const pins = await prisma.projectMilestoneAssignment.findMany({
    where: { version: { setId } },
    select: { versionId: true },
  });
  return new Set(pins.map((p) => p.versionId));
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listMilestoneSets() {
  return prisma.milestoneSet.findMany({
    where: { archivedAt: null },
    orderBy: [{ isLabWide: "desc" }, { name: "asc" }],
    include: {
      createdBy: { select: { firstName: true, lastName: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, versionNumber: true, entries: true, createdAt: true },
      },
      _count: { select: { versions: true } },
    },
  });
}

export async function getMilestoneSet(id: string) {
  return prisma.milestoneSet.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { versionNumber: "asc" },
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      },
    },
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createMilestoneSet(opts: {
  name: string;
  description?: string | null;
  createdById: string;
}) {
  return prisma.milestoneSet.create({
    data: {
      name: opts.name,
      description: opts.description ?? null,
      createdById: opts.createdById,
    },
  });
}

/** Persist the working copy without cutting a version (like Form "Save draft"). */
export async function saveMilestoneDraft(setId: string, entries: MilestoneEntry[]): Promise<void> {
  await prisma.milestoneSet.update({
    where: { id: setId },
    data: { draftEntries: coerceEntries(entries) as unknown as Prisma.InputJsonValue },
  });
}

/** Freeze the current entries into the next immutable version and clear the
 *  draft (mirrors Form "Save as version" clearing draftQuestions). */
export async function saveMilestoneVersion(
  setId: string,
  entries: MilestoneEntry[],
  createdById: string,
): Promise<void> {
  const clean = coerceEntries(entries);
  const last = await prisma.milestoneSetVersion.findFirst({
    where: { setId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (last?.versionNumber ?? 0) + 1;
  await prisma.$transaction([
    prisma.milestoneSetVersion.create({
      data: {
        setId,
        versionNumber,
        entries: clean as unknown as Prisma.InputJsonValue,
        createdById,
      },
    }),
    prisma.milestoneSet.update({
      where: { id: setId },
      data: { draftEntries: Prisma.DbNull },
    }),
  ]);
}

// ─── Lazy Lab-set seed ────────────────────────────────────────────────────────

/**
 * The one lab-wide milestone set, seeded on first use from the current term's
 * timeline milestones (loadTimeline seeds those from DEFAULT_WEEKS). Mirrors how
 * loadTimeline lazily seeds the term timeline. There is no unique index on
 * isLabWide — a concurrent first open could in theory create two; the check
 * before create makes that vanishingly unlikely for a Core-only page, and reads
 * always take the first.
 */
export async function ensureLabMilestoneSet(createdById: string) {
  const existing = await prisma.milestoneSet.findFirst({ where: { isLabWide: true } });
  if (existing) return existing;

  const timeline = await loadTimeline();
  const entries: MilestoneEntry[] = timeline.weeks.flatMap((w) =>
    w.milestones.map((m) => ({
      id: m.id,
      weekIndex: w.index,
      name: m.name,
      detail: m.detail,
      labWide: m.labWide,
    })),
  );

  return prisma.milestoneSet.create({
    data: {
      name: LAB_DEFAULT_SET_NAME,
      isLabWide: true,
      createdById,
      versions: {
        create: { versionNumber: 1, entries: entries as unknown as Prisma.InputJsonValue, createdById },
      },
    },
  });
}
