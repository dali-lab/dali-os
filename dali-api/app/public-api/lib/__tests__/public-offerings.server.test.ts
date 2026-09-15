import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    educationOffering: { findMany: vi.fn() },
    // Term windows: the payload's term code and the ?term= filter are both
    // derived from them, so every call reads this.
    term: { findMany: vi.fn() },
  },
}));
// Mock the collab-doc readers so importing the offerings module doesn't pull in
// the whole editor stack; the description flattening is exercised via them.
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));
vi.mock("~/components/doc/schema/configs", () => ({ blocksToPlainText: vi.fn() }));

import { prisma } from "~/lib/db";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import {
  listPublicOfferings,
  parseOfferingsFilter,
} from "~/public-api/lib/public-offerings.server";

const mockPrisma = prisma as unknown as {
  educationOffering: { findMany: ReturnType<typeof vi.fn> };
  term: { findMany: ReturnType<typeof vi.fn> };
};
const mockReadDoc = readDocAsBlocks as unknown as ReturnType<typeof vi.fn>;
const mockToPlain = blocksToPlainText as unknown as ReturnType<typeof vi.fn>;

// Fixed clock so date-parts, filters, and registration.open are deterministic.
// All dates below fall inside US Eastern Daylight Time (UTC-4).
const NOW = new Date("2026-09-01T12:00:00.000Z");

// Seeded term windows, newest first (as termWindows() returns them). The gap
// between 26X and 26F is what makes a date resolve to no term at all.
const TERM_26F_START = new Date("2026-09-08T00:00:00.000Z");
const TERM_26F_END = new Date("2026-11-24T00:00:00.000Z");
const TERMS = [
  { id: "t-26f", code: "26F", startDate: TERM_26F_START, endDate: TERM_26F_END },
  {
    id: "t-26x",
    code: "26X",
    startDate: new Date("2026-06-22T00:00:00.000Z"),
    endDate: new Date("2026-08-25T00:00:00.000Z"),
  },
];

// A published, not-yet-started miniseries. Times chosen so the Eastern parts
// are easy to eyeball: 20:00Z = 4 PM EDT, 21:00Z = 5 PM EDT, 13:00Z = 9 AM EDT.
const baseRow = {
  id: "o1",
  title: "Intro to Figma",
  type: "Miniseries",
  descriptionDocId: null as string | null,
  applicationFormId: "form1" as string | null,
  startsAt: new Date("2026-09-15T20:00:00.000Z"),
  endsAt: new Date("2026-10-06T21:00:00.000Z"),
  registrationOpensAt: new Date("2026-08-25T13:00:00.000Z"),
  registrationClosesAt: new Date("2026-09-13T03:59:00.000Z"),
  sessions: [
    { sequence: 1, title: "Basics", location: "DALI Pod", datetime: new Date("2026-09-15T20:00:00.000Z") },
    { sequence: 2, title: null, location: null, datetime: new Date("2026-09-22T20:00:00.000Z") },
  ],
};

const whereOf = () =>
  mockPrisma.educationOffering.findMany.mock.calls.at(-1)?.[0].where;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = "https://os.example";
  mockReadDoc.mockResolvedValue([]);
  mockToPlain.mockReturnValue("");
  mockPrisma.educationOffering.findMany.mockResolvedValue([]);
  mockPrisma.term.findMany.mockResolvedValue(TERMS);
});

describe("parseOfferingsFilter", () => {
  const parse = (qs: string) => parseOfferingsFilter(new URLSearchParams(qs));

  it("defaults scope to undefined (the loader treats that as upcoming)", () => {
    expect(parse("")).toEqual({ filter: { scope: undefined } });
  });

  it("accepts the three valid scopes", () => {
    expect(parse("scope=past")).toEqual({ filter: { scope: "past" } });
    expect(parse("scope=all")).toEqual({ filter: { scope: "all" } });
    expect(parse("scope=upcoming")).toEqual({ filter: { scope: "upcoming" } });
  });

  it("rejects an unknown scope", () => {
    expect(parse("scope=nonsense")).toEqual({
      error: "Invalid 'scope' (use upcoming, past, or all)",
    });
  });

  it("parses from/to into Dates", () => {
    const result = parse("from=2026-09-01&to=2026-09-30");
    expect(result).toEqual({
      filter: {
        scope: undefined,
        from: new Date("2026-09-01"),
        to: new Date("2026-09-30"),
      },
    });
  });

  it("extracts a term code", () => {
    expect(parse("term=26F")).toEqual({ filter: { scope: undefined, term: "26F" } });
    // Blank/whitespace term is dropped, not passed through as "".
    expect(parse("term=%20%20")).toEqual({ filter: { scope: undefined } });
  });

  it("maps type to the DB enum, case-insensitively", () => {
    expect(parse("type=workshop")).toEqual({ filter: { scope: undefined, type: "Workshop" } });
    expect(parse("type=Miniseries")).toEqual({ filter: { scope: undefined, type: "Miniseries" } });
  });

  it("rejects an unknown type", () => {
    expect(parse("type=seminar")).toEqual({
      error: "Invalid 'type' (use miniseries or workshop)",
    });
  });

  it("rejects an unparseable date", () => {
    expect(parse("from=not-a-date")).toEqual({ error: "Invalid 'from' date" });
    expect(parse("to=13/13/2026")).toEqual({ error: "Invalid 'to' date" });
  });
});

describe("listPublicOfferings query shape", () => {
  it("defaults to upcoming: published and not yet started", async () => {
    await listPublicOfferings({}, NOW);
    expect(mockPrisma.educationOffering.findMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.educationOffering.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: "Published", AND: [{ startsAt: { gt: NOW } }] });
    expect(arg.orderBy).toEqual({ startsAt: "asc" });
    expect(arg.select.sessions.orderBy).toEqual({ sequence: "asc" });
  });

  it("scope=past reads published offerings that have already ended", async () => {
    await listPublicOfferings({ scope: "past" }, NOW);
    expect(whereOf()).toEqual({ status: "Published", AND: [{ endsAt: { lt: NOW } }] });
  });

  it("scope=all applies no date bound", async () => {
    await listPublicOfferings({ scope: "all" }, NOW);
    expect(whereOf()).toEqual({ status: "Published" });
  });

  it("from/to filters to offerings whose run overlaps the window", async () => {
    const from = new Date("2026-09-01");
    const to = new Date("2026-09-30");
    await listPublicOfferings({ from, to }, NOW);
    expect(whereOf()).toEqual({
      status: "Published",
      AND: [{ startsAt: { lte: to } }, { endsAt: { gte: from } }],
    });
  });

  it("a one-sided window omits the missing bound", async () => {
    const from = new Date("2026-09-01");
    await listPublicOfferings({ from }, NOW);
    expect(whereOf()).toEqual({ status: "Published", AND: [{ endsAt: { gte: from } }] });
  });

  it("an explicit window overrides scope", async () => {
    const to = new Date("2026-12-31");
    await listPublicOfferings({ scope: "upcoming", to }, NOW);
    expect(whereOf()).toEqual({ status: "Published", AND: [{ startsAt: { lte: to } }] });
  });

  it("term alone becomes that term's date window (scope defaults to all)", async () => {
    await listPublicOfferings({ term: "26F" }, NOW);
    expect(whereOf()).toEqual({
      status: "Published",
      AND: [{ startsAt: { gte: TERM_26F_START, lte: TERM_26F_END } }],
    });
  });

  it("term composes with an explicit scope", async () => {
    await listPublicOfferings({ term: "26F", scope: "past" }, NOW);
    expect(whereOf()).toEqual({
      status: "Published",
      AND: [
        { startsAt: { gte: TERM_26F_START, lte: TERM_26F_END } },
        { endsAt: { lt: NOW } },
      ],
    });
  });

  it("an unseeded term code matches nothing without querying offerings", async () => {
    expect(await listPublicOfferings({ term: "99W" }, NOW)).toEqual([]);
    expect(mockPrisma.educationOffering.findMany).not.toHaveBeenCalled();
  });

  it("type filters to one offering type, keeping the upcoming default", async () => {
    await listPublicOfferings({ type: "Workshop" }, NOW);
    expect(whereOf()).toEqual({
      status: "Published",
      type: "Workshop",
      AND: [{ startsAt: { gt: NOW } }],
    });
  });

  it("type composes with term and scope", async () => {
    await listPublicOfferings({ type: "Miniseries", term: "26F", scope: "past" }, NOW);
    expect(whereOf()).toEqual({
      status: "Published",
      type: "Miniseries",
      AND: [
        { startsAt: { gte: TERM_26F_START, lte: TERM_26F_END } },
        { endsAt: { lt: NOW } },
      ],
    });
  });
});

describe("listPublicOfferings mapping", () => {
  it("maps the range, session schedule, type, and sign-up link", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([baseRow]);

    const [m] = await listPublicOfferings({}, NOW);

    expect(m.id).toBe("o1");
    expect(m.name).toBe("Intro to Figma");
    expect(m.type).toBe("miniseries");
    expect(m.term).toBe("26F");
    expect(m.startDate).toBe("2026-09-15T20:00:00.000Z");
    expect(m.endDate).toBe("2026-10-06T21:00:00.000Z");
    expect(m.sessions).toHaveLength(2);
    expect(m.sessions[0]).toEqual({
      sequence: 1,
      title: "Basics",
      location: "DALI Pod",
      date: "2026-09-15T20:00:00.000Z",
    });
    // Untitled/location-less sessions carry through as null, not "".
    expect(m.sessions[1].title).toBeNull();
    expect(m.sessions[1].location).toBeNull();
    expect(m.signUpLink).toBe("https://os.example/education/o1");
  });

  it("computes registration.open from the window around now", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([baseRow]);
    const [open] = await listPublicOfferings({}, NOW); // Sep 1 is inside the window
    expect(open.registration.open).toBe(true);
    expect(open.registration.opensAt).toBe("2026-08-25T13:00:00.000Z");

    mockPrisma.educationOffering.findMany.mockResolvedValue([baseRow]);
    const [closed] = await listPublicOfferings({}, new Date("2026-08-01T12:00:00.000Z"));
    expect(closed.registration.open).toBe(false); // before registration opens
  });

  it("flattens the description doc to trimmed plain text", async () => {
    mockReadDoc.mockResolvedValue([{ type: "paragraph" }]);
    mockToPlain.mockReturnValue("  A hands-on miniseries.  ");
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { ...baseRow, descriptionDocId: "doc1" },
    ]);

    const [m] = await listPublicOfferings({}, NOW);
    expect(mockReadDoc).toHaveBeenCalledWith("doc1");
    expect(m.description).toBe("A hands-on miniseries.");
  });

  it("returns an empty description and never reads a doc when there is none", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { ...baseRow, descriptionDocId: null },
    ]);
    const [m] = await listPublicOfferings({}, NOW);
    expect(mockReadDoc).not.toHaveBeenCalled();
    expect(m.description).toBe("");
  });

  it("renders '#' as the sign-up link when no application form exists yet", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { ...baseRow, applicationFormId: null },
    ]);
    const [m] = await listPublicOfferings({}, NOW);
    expect(m.signUpLink).toBe("#");
  });

  it("derives a null term for a run starting outside every term window", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      // Sep 1 falls in the gap between 26X and 26F.
      { ...baseRow, startsAt: new Date("2026-09-01T20:00:00.000Z") },
    ]);
    const [m] = await listPublicOfferings({}, NOW);
    expect(m.term).toBeNull();
  });

  // A Published offering can have null startsAt/endsAt (no sessions). It has no
  // schedule to render, and `null.toISOString()` would throw and 500 the whole
  // endpoint — so it's dropped, and the scheduled offerings still come back.
  it("skips published offerings with a null start/end instead of crashing", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { ...baseRow, id: "no-schedule", startsAt: null, endsAt: null },
      baseRow,
    ]);
    const result = await listPublicOfferings({}, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("o1");
  });
});
