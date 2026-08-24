import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { educationOffering: { findMany: vi.fn() } },
}));
// Mock the collab-doc readers so importing the offerings module doesn't pull in
// the whole editor stack; the description flattening is exercised via them.
vi.mock("~/collab/read", () => ({ readDocAsBlocks: vi.fn() }));
vi.mock("~/components/doc/schema/configs", () => ({ blocksToPlainText: vi.fn() }));

import { prisma } from "~/lib/db";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToPlainText } from "~/components/doc/schema/configs";
import { listPublicOfferings } from "~/public-api/lib/public-offerings.server";

const mockPrisma = prisma as unknown as {
  educationOffering: { findMany: ReturnType<typeof vi.fn> };
};
const mockReadDoc = readDocAsBlocks as unknown as ReturnType<typeof vi.fn>;
const mockToPlain = blocksToPlainText as unknown as ReturnType<typeof vi.fn>;

// Fixed clock so date-parts and registration.open are deterministic. All dates
// below fall inside US Eastern Daylight Time (UTC-4).
const NOW = new Date("2026-09-01T12:00:00.000Z");

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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = "https://os.example";
  mockReadDoc.mockResolvedValue([]);
  mockToPlain.mockReturnValue("");
});

describe("listPublicOfferings query shape", () => {
  it("only reads published offerings that have not started yet", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([]);
    await listPublicOfferings(NOW);
    expect(mockPrisma.educationOffering.findMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.educationOffering.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: "Published", startsAt: { gt: NOW } });
    expect(arg.orderBy).toEqual({ startsAt: "asc" });
    // Sessions come back in teaching order.
    expect(arg.select.sessions.orderBy).toEqual({ sequence: "asc" });
  });
});

describe("listPublicOfferings mapping", () => {
  it("maps the range, session schedule, type, and sign-up link", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([baseRow]);

    const [m] = await listPublicOfferings(NOW);

    expect(m.id).toBe("o1");
    expect(m.name).toBe("Intro to Figma");
    expect(m.type).toBe("miniseries");
    expect(m.startDate).toEqual({
      day: 15, month: "September", year: 2026, time: "4 PM",
      fullDate: "2026-09-15T20:00:00.000Z",
    });
    expect(m.endDate).toMatchObject({ day: 6, month: "October", time: "5 PM" });
    expect(m.sessions).toHaveLength(2);
    expect(m.sessions[0]).toEqual({
      sequence: 1, title: "Basics", location: "DALI Pod",
      date: {
        day: 15, month: "September", year: 2026, time: "4 PM",
        fullDate: "2026-09-15T20:00:00.000Z",
      },
    });
    // Untitled/location-less sessions carry through as null, not "".
    expect(m.sessions[1].title).toBeNull();
    expect(m.sessions[1].location).toBeNull();
    expect(m.signUpLink).toBe("https://os.example/education/o1");
  });

  it("computes registration.open from the window around now", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([baseRow]);
    const [open] = await listPublicOfferings(NOW); // Sep 1 is inside the window
    expect(open.registration.open).toBe(true);
    expect(open.registration.opensAt).toMatchObject({ day: 25, month: "August", time: "9 AM" });

    mockPrisma.educationOffering.findMany.mockResolvedValue([baseRow]);
    const [closed] = await listPublicOfferings(new Date("2026-08-01T12:00:00.000Z"));
    expect(closed.registration.open).toBe(false); // before registration opens
  });

  it("flattens the description doc to trimmed plain text", async () => {
    mockReadDoc.mockResolvedValue([{ type: "paragraph" }]);
    mockToPlain.mockReturnValue("  A hands-on miniseries.  ");
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { ...baseRow, descriptionDocId: "doc1" },
    ]);

    const [m] = await listPublicOfferings(NOW);
    expect(mockReadDoc).toHaveBeenCalledWith("doc1");
    expect(m.description).toBe("A hands-on miniseries.");
  });

  it("returns an empty description and never reads a doc when there is none", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { ...baseRow, descriptionDocId: null },
    ]);
    const [m] = await listPublicOfferings(NOW);
    expect(mockReadDoc).not.toHaveBeenCalled();
    expect(m.description).toBe("");
  });

  it("renders '#' as the sign-up link when no application form exists yet", async () => {
    mockPrisma.educationOffering.findMany.mockResolvedValue([
      { ...baseRow, applicationFormId: null },
    ]);
    const [m] = await listPublicOfferings(NOW);
    expect(m.signUpLink).toBe("#");
  });
});
