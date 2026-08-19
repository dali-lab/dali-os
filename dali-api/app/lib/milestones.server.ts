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

// ─── Per-project assignment ───────────────────────────────────────────────────

/** Sets offered in the assignment dropdown, each resolved to its latest version
 *  (the one a pin will freeze). A set with no versions yet can't be assigned. */
export async function assignableSets() {
  const sets = await prisma.milestoneSet.findMany({
    where: { archivedAt: null },
    orderBy: [{ isLabWide: "desc" }, { name: "asc" }],
    include: {
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, versionNumber: true },
      },
    },
  });
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    isLabWide: s.isLabWide,
    latestVersionId: s.versions[0]?.id ?? null,
    latestVersionNumber: s.versions[0]?.versionNumber ?? null,
  }));
}

/** The term's active projects with their current milestone pin (if any). */
export async function termProjectsWithAssignment(termId: string) {
  const projects = await prisma.project.findMany({
    where: { status: "Active", projectTerms: { some: { termId } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      iconEmoji: true,
      milestoneAssignments: {
        where: { termId },
        select: {
          version: {
            select: { versionNumber: true, setId: true, set: { select: { name: true } } },
          },
        },
      },
    },
  });
  return projects.map((p) => {
    const a = p.milestoneAssignments[0];
    return {
      id: p.id,
      name: p.name,
      iconEmoji: p.iconEmoji,
      assignedSetId: a?.version.setId ?? null,
      assignedSetName: a?.version.set.name ?? null,
      assignedVersionNumber: a?.version.versionNumber ?? null,
    };
  });
}

/** Pin a set's LATEST version to a project for a term (upsert). No-op if the set
 *  has no versions. Pinning locks that version (isMilestoneVersionLocked). */
export async function assignMilestoneSet(opts: {
  projectId: string;
  termId: string;
  setId: string;
  assignedById: string;
}): Promise<void> {
  const latest = await prisma.milestoneSetVersion.findFirst({
    where: { setId: opts.setId },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  if (!latest) return;
  await prisma.projectMilestoneAssignment.upsert({
    where: { projectId_termId: { projectId: opts.projectId, termId: opts.termId } },
    create: {
      projectId: opts.projectId,
      termId: opts.termId,
      versionId: latest.id,
      assignedById: opts.assignedById,
    },
    update: {
      versionId: latest.id,
      assignedById: opts.assignedById,
      assignedAt: new Date(),
    },
  });
}

/** Remove a project's milestone pin for a term. */
export async function unassignMilestoneSet(opts: {
  projectId: string;
  termId: string;
}): Promise<void> {
  await prisma.projectMilestoneAssignment.deleteMany({
    where: { projectId: opts.projectId, termId: opts.termId },
  });
}
