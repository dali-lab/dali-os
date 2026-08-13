import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted so the vi.mock factories below (which run before imports) can close
// over these without tripping the hoisting rule.
const { prisma, currentTerm } = vi.hoisted(() => ({
  prisma: {
    timelineWeek: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    timelineMilestone: { deleteMany: vi.fn() },
    timelineLane: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  currentTerm: vi.fn(),
}));

vi.mock("~/lib/db", () => ({ prisma }));
vi.mock("~/lib/roles", () => ({ currentTerm }));
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: async (v: string | null) => (v ? `https://signed/${v}` : null),
}));

import { loadTimeline, resetWeek } from "~/lib/term-timeline.server";
import { DEFAULT_WEEKS, DOMAINS } from "~/lib/term-timeline";

const TERM = { id: "term1", season: "F", year: 2026 };

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe("loadTimeline", () => {
  it("falls back to the static defaults when there is no term", async () => {
    currentTerm.mockResolvedValue(null);

    const timeline = await loadTimeline();

    expect(timeline.termId).toBeNull();
    expect(timeline.weeks).toHaveLength(DEFAULT_WEEKS.length);
    expect(timeline.weeks[0].title).toBe(DEFAULT_WEEKS[0].title);
    // A null week id is what the page reads as "nothing here is editable".
    expect(timeline.weeks.every((w) => w.id === null)).toBe(true);
    expect(prisma.timelineWeek.create).not.toHaveBeenCalled();
  });

  it("seeds a term's ten weeks from the defaults on first open", async () => {
    currentTerm.mockResolvedValue(TERM);
    prisma.timelineWeek.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await loadTimeline();

    expect(prisma.timelineWeek.create).toHaveBeenCalledTimes(DEFAULT_WEEKS.length);
    const first = prisma.timelineWeek.create.mock.calls[0][0].data;
    expect(first).toMatchObject({ termId: "term1", weekIndex: 0, title: DEFAULT_WEEKS[0].title });
    expect(first.lanes.create).toHaveLength(DOMAINS.length);
  });

  it("only creates the weeks a term is missing", async () => {
    currentTerm.mockResolvedValue(TERM);
    const existing = DEFAULT_WEEKS.map((_, weekIndex) => ({ weekIndex })).slice(0, 8);
    prisma.timelineWeek.findMany.mockResolvedValueOnce(existing).mockResolvedValueOnce([]);

    await loadTimeline();

    const created = prisma.timelineWeek.create.mock.calls.map((c) => c[0].data.weekIndex);
    expect(created).toEqual([8, 9]);
  });

  it("treats a lost seeding race as already seeded", async () => {
    currentTerm.mockResolvedValue(TERM);
    prisma.timelineWeek.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prisma.timelineWeek.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    await expect(loadTimeline()).resolves.toBeDefined();
  });

  it("orders lanes by DOMAINS and signs the week image", async () => {
    currentTerm.mockResolvedValue(TERM);
    prisma.timelineWeek.findMany.mockResolvedValueOnce(
      DEFAULT_WEEKS.map((_, weekIndex) => ({ weekIndex })),
    );
    prisma.timelineWeek.findMany.mockResolvedValueOnce([
      {
        id: "w0",
        weekIndex: 0,
        title: "Kickoff",
        dates: "Sep 15 – 19",
        blurb: "…",
        imageKey: "uploads/term-timeline/a.png",
        imageAlt: "Kickoff",
        resources: ["Handbook"],
        format: { title: { bold: true } },
        milestones: [{ id: "m1", name: "Kickoff", detail: "…", labWide: false }],
        // Deliberately reversed: the page renders lanes in DOMAINS order.
        lanes: [...DOMAINS].reverse().map((d, i) => ({
          id: `l${i}`,
          domainKey: d.key,
          role: d.name,
          deliverables: [],
          challenge: "",
        })),
      },
    ]);

    const timeline = await loadTimeline();

    expect(timeline.termLabel).toBe("Fall 2026 · Weeks 0–9");
    expect(timeline.weeks[0].lanes.map((l) => l.domainKey)).toEqual(DOMAINS.map((d) => d.key));
    expect(timeline.weeks[0].imageUrl).toBe("https://signed/uploads/term-timeline/a.png");
    expect(timeline.weeks[0].format).toEqual({ title: { bold: true } });
  });
});

describe("resetWeek", () => {
  it("restores that week's default content and clears its formatting", async () => {
    prisma.timelineWeek.findUnique.mockResolvedValue({ weekIndex: 4 });

    await resetWeek("w4");

    expect(prisma.timelineMilestone.deleteMany).toHaveBeenCalledWith({ where: { weekId: "w4" } });
    const update = prisma.timelineWeek.update.mock.calls[0][0];
    expect(update.data).toMatchObject({
      title: DEFAULT_WEEKS[4].title,
      imageKey: null,
      format: {},
    });
    expect(update.data.milestones.create).toHaveLength(DEFAULT_WEEKS[4].milestones.length);
  });

  it("does nothing for a week id that is gone", async () => {
    prisma.timelineWeek.findUnique.mockResolvedValue(null);

    await resetWeek("missing");

    expect(prisma.timelineWeek.update).not.toHaveBeenCalled();
  });
});
