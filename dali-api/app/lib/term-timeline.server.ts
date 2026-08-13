import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  DEFAULT_TERM_LABEL,
  DEFAULT_WEEKS,
  DOMAINS,
  SEASON_LABELS,
  type FormatMap,
} from "~/lib/term-timeline";

export type TimelineMilestoneView = {
  id: string;
  name: string;
  detail: string;
  labWide: boolean;
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
  weeks: TimelineWeekView[];
};

/**
 * Create a term's ten weeks from the defaults, once. Concurrent first opens
 * race here, so a losing insert hits the (termId, weekIndex) unique index and
 * is treated as "someone else seeded it" rather than an error.
 */
async function seedTimeline(termId: string): Promise<void> {
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
          lanes: {
            create: DOMAINS.map((d, j) => ({
              domainKey: d.key,
              role: week.lanes[j].role,
              deliverables: week.lanes[j].deliverables,
              challenge: week.lanes[j].challenge,
            })),
          },
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
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

  await seedTimeline(term.id);

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
      // Lanes render in DOMAINS order, whatever order the rows came back in.
      lanes: DOMAINS.flatMap((d) => {
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
    weeks,
  };
}

/** Put a week back to the seed content, dropping its edits and formatting. */
export async function resetWeek(weekId: string): Promise<void> {
  const week = await prisma.timelineWeek.findUnique({
    where: { id: weekId },
    select: { weekIndex: true },
  });
  if (!week) return;
  const defaults = DEFAULT_WEEKS[week.weekIndex];
  if (!defaults) return;

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
        lanes: {
          create: DOMAINS.map((d, j) => ({
            domainKey: d.key,
            role: defaults.lanes[j].role,
            deliverables: defaults.lanes[j].deliverables,
            challenge: defaults.lanes[j].challenge,
          })),
        },
      },
    }),
  ]);
}
