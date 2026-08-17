import { randomUUID } from "node:crypto";

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  DEFAULT_TERM_LABEL,
  DEFAULT_WEEKS,
  DOMAINS,
  DOMAIN_COLORS,
  SEASON_LABELS,
  defaultLane,
  type FormatMap,
} from "~/lib/term-timeline";

export type TimelineMilestoneView = {
  id: string;
  name: string;
  detail: string;
  labWide: boolean;
};

export type TimelineDomainView = {
  id: string;
  key: string;
  name: string;
  color: string;
};

export type TimelineLaneView = {
  id: string;
  domainKey: string;
  role: string;
  deliverables: string[];
  challenge: string;
};

export type TimelineWeekView = {
  /** Null only when the page is rendering the static defaults (no Term row). */
  id: string | null;
  index: number;
  title: string;
  dates: string;
  blurb: string;
  /** Presigned (or pass-through) URL — what the <img> actually loads. */
  imageUrl: string | null;
  imageAlt: string | null;
  resources: string[];
  format: FormatMap;
  milestones: TimelineMilestoneView[];
  lanes: TimelineLaneView[];
};

export type Timeline = {
  termId: string | null;
  termLabel: string;
  /** The term's lanes, in the order every week renders them. */
  domains: TimelineDomainView[];
  weeks: TimelineWeekView[];
};

/**
 * Create a term's ten weeks from the defaults, once. Concurrent first opens
 * race here, so a losing insert hits the (termId, weekIndex) unique index and
 * is treated as "someone else seeded it" rather than an error.
 */
async function seedTimeline(termId: string, domains: TimelineDomainView[]): Promise<void> {
  const existing = await prisma.timelineWeek.findMany({
    where: { termId },
    select: { weekIndex: true },
  });
  const have = new Set(existing.map((w) => w.weekIndex));
  if (have.size >= DEFAULT_WEEKS.length) return;

  for (const [index, week] of DEFAULT_WEEKS.entries()) {
    if (have.has(index)) continue;
    try {
      await prisma.timelineWeek.create({
        data: {
          termId,
          weekIndex: index,
          title: week.title,
          dates: week.dates,
          blurb: week.blurb,
          resources: week.resources,
          milestones: {
            create: week.milestones.map((m, position) => ({
              name: m.name,
              detail: m.detail,
              labWide: m.labWide,
              position,
            })),
          },
          lanes: { create: domains.map((d) => laneSeed(index, d.key)) },
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
}

function laneSeed(weekIndex: number, domainKey: string) {
  const lane = defaultLane(weekIndex, domainKey);
  return {
    domainKey,
    role: lane.role,
    deliverables: lane.deliverables,
    challenge: lane.challenge,
  };
}

/**
 * A term's domain vocabulary, seeded from DOMAINS the first time it is asked
 * for. Losing a race with a concurrent first open is not an error — whoever
 * won wrote the same four rows.
 */
async function loadDomains(termId: string): Promise<TimelineDomainView[]> {
  const existing = await prisma.timelineDomain.findMany({
    where: { termId },
    orderBy: { position: "asc" },
    select: { id: true, key: true, name: true, color: true },
  });
  if (existing.length > 0) return existing;

  try {
    await prisma.timelineDomain.createMany({
      data: DOMAINS.map((d, position) => ({ termId, ...d, position })),
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  return prisma.timelineDomain.findMany({
    where: { termId },
    orderBy: { position: "asc" },
    select: { id: true, key: true, name: true, color: true },
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002";
}

function asFormatMap(value: unknown): FormatMap {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as FormatMap) : {};
}

/** The current term's timeline, seeding it from the defaults on first open. */
export async function loadTimeline(): Promise<Timeline> {
  const term = await currentTerm();

  // A database with no terms at all (a fresh checkout) still gets a readable
  // page: the defaults, with nothing to edit.
  if (!term) {
    return {
      termId: null,
      termLabel: DEFAULT_TERM_LABEL,
      domains: DOMAINS.map((d) => ({ id: d.key, ...d })),
      weeks: DEFAULT_WEEKS.map((w, index) => ({
        id: null,
        index,
        title: w.title,
        dates: w.dates,
        blurb: w.blurb,
        imageUrl: null,
        imageAlt: null,
        resources: w.resources,
        format: {},
        milestones: w.milestones.map((m, i) => ({ id: `default-${index}-${i}`, ...m })),
        lanes: DOMAINS.map((d, j) => ({
          id: `default-${index}-${d.key}`,
          domainKey: d.key,
          ...w.lanes[j],
        })),
      })),
    };
  }

  const domains = await loadDomains(term.id);
  await seedTimeline(term.id, domains);

  const rows = await prisma.timelineWeek.findMany({
    where: { termId: term.id },
    orderBy: { weekIndex: "asc" },
    include: {
      milestones: { orderBy: { position: "asc" } },
      lanes: true,
    },
  });

  const weeks = await Promise.all(
    rows.map(async (w) => ({
      id: w.id,
      index: w.weekIndex,
      title: w.title,
      dates: w.dates,
      blurb: w.blurb,
      imageUrl: await resolvePhotoUrl(w.imageKey),
      imageAlt: w.imageAlt,
      resources: w.resources,
      format: asFormatMap(w.format),
      milestones: w.milestones.map((m) => ({
        id: m.id,
        name: m.name,
        detail: m.detail,
        labWide: m.labWide,
      })),
      // Lanes render in the term's domain order, whatever order they came back in.
      lanes: domains.flatMap((d) => {
        const lane = w.lanes.find((l) => l.domainKey === d.key);
        return lane
          ? [
              {
                id: lane.id,
                domainKey: lane.domainKey,
                role: lane.role,
                deliverables: lane.deliverables,
                challenge: lane.challenge,
              },
            ]
          : [];
      }),
    })),
  );

  return {
    termId: term.id,
    termLabel: `${SEASON_LABELS[term.season] ?? term.season} ${term.year} · Weeks 0–${DEFAULT_WEEKS.length - 1}`,
    domains,
    weeks,
  };
}

/** Put a week back to the seed content, dropping its edits and formatting. */
export async function resetWeek(weekId: string): Promise<void> {
  const week = await prisma.timelineWeek.findUnique({
    where: { id: weekId },
    select: { weekIndex: true, termId: true },
  });
  if (!week) return;
  const defaults = DEFAULT_WEEKS[week.weekIndex];
  if (!defaults) return;
  // Lanes come back for whatever domains the term has now, not the four the
  // defaults were written for — a domain added since keeps its lane, blank.
  const domains = await prisma.timelineDomain.findMany({
    where: { termId: week.termId },
    orderBy: { position: "asc" },
    select: { key: true },
  });

  await prisma.$transaction([
    prisma.timelineMilestone.deleteMany({ where: { weekId } }),
    prisma.timelineLane.deleteMany({ where: { weekId } }),
    prisma.timelineWeek.update({
      where: { id: weekId },
      data: {
        title: defaults.title,
        dates: defaults.dates,
        blurb: defaults.blurb,
        resources: defaults.resources,
        imageKey: null,
        imageAlt: null,
        format: {},
        milestones: {
          create: defaults.milestones.map((m, position) => ({
            name: m.name,
            detail: m.detail,
            labWide: m.labWide,
            position,
          })),
        },
        lanes: { create: domains.map((d) => laneSeed(week.weekIndex, d.key)) },
      },
    }),
  ]);
}

/**
 * Add a lane to the term: one TimelineDomain plus the lane it needs on every
 * week, so the new column is editable everywhere the moment it appears.
 */
export async function addDomain(termId: string): Promise<void> {
  const existing = await prisma.timelineDomain.findMany({
    where: { termId },
    orderBy: { position: "asc" },
    select: { color: true },
  });
  const used = new Set(existing.map((d) => d.color));
  const color =
    DOMAIN_COLORS.find((c) => !used.has(c)) ?? DOMAIN_COLORS[existing.length % DOMAIN_COLORS.length];
  // The seeded four own readable keys ("pm", …); later ones only need to be
  // unique, since nothing outside the term's own lanes reads them.
  const key = randomUUID();

  const weeks = await prisma.timelineWeek.findMany({
    where: { termId },
    select: { id: true, weekIndex: true },
  });

  await prisma.$transaction([
    prisma.timelineDomain.create({
      data: { termId, key, name: "New domain", color, position: existing.length },
    }),
    prisma.timelineLane.createMany({
      data: weeks.map((w) => ({ weekId: w.id, ...laneSeed(w.weekIndex, key) })),
    }),
  ]);
}

/** Drop a lane from the term, and the per-week lanes that hung off it. */
export async function removeDomain(domainId: string): Promise<void> {
  const domain = await prisma.timelineDomain.findUnique({
    where: { id: domainId },
    select: { termId: true, key: true },
  });
  if (!domain) return;

  await prisma.$transaction([
    prisma.timelineLane.deleteMany({
      where: { domainKey: domain.key, week: { termId: domain.termId } },
    }),
    prisma.timelineDomain.delete({ where: { id: domainId } }),
  ]);
}
