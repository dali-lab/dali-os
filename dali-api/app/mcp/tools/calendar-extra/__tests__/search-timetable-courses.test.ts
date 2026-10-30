import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/mcp/registry", () => {
  class McpError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = "McpError";
      this.status = status;
    }
  }
  class McpInvalidError extends McpError {
    constructor(message = "Invalid params") { super(message, 400); this.name = "McpInvalidError"; }
  }
  class McpNotFoundError extends McpError {
    constructor(message = "Not found") { super(message, 404); this.name = "McpNotFoundError"; }
  }
  class McpForbiddenError extends McpError {
    constructor(message = "Forbidden") { super(message, 403); this.name = "McpForbiddenError"; }
  }
  return { McpError, McpInvalidError, McpNotFoundError, McpForbiddenError };
});
vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  runSearchTimetableCourses,
  SEARCH_TIMETABLE_COURSES_DEF,
} from "~/mcp/tools/calendar-extra/search-timetable-courses";

const mockPrisma = prisma as unknown as {
  courseOffering: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("search_timetable_courses", () => {
  it("requires mcp:read scope", () => {
    expect(SEARCH_TIMETABLE_COURSES_DEF.requiredScope).toBe("mcp:read");
  });

  it("throws McpInvalidError for query shorter than 2 chars", async () => {
    await expect(
      runSearchTimetableCourses("u1", { termId: "t1", q: "a" }),
    ).rejects.toMatchObject({ name: "McpInvalidError" });
  });

  it("returns matching courses", async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([
      {
        crn: "12345",
        subject: "COSC",
        number: "89",
        section: "01",
        title: "Foundations of Applied Computer Science",
        periodCode: "2A",
        periodText: "MWF 8:05-9:10",
        building: "Sudikoff",
        room: "214",
        instructor: "Smith",
        crosslist: null,
        distributive: "TAS",
        enrollLimit: 20,
        enrollCurrent: 15,
      },
    ]);

    const out = await runSearchTimetableCourses("u1", { termId: "t1", q: "cosc 89" });
    expect(out.courses).toHaveLength(1);
    expect(out.courses[0]).toMatchObject({
      crn: "12345",
      subject: "COSC",
      number: "89",
      periodCode: "2A",
    });
  });

  it("passes lowercased query to Prisma", async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([]);

    await runSearchTimetableCourses("u1", { termId: "t1", q: "COSC" });

    expect(mockPrisma.courseOffering.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { termId: "t1", searchText: { contains: "cosc" } },
      }),
    );
  });

  it("walks pages with a cursor, tiebreaking on id, and ends with a null cursor", async () => {
    const course = (n: string) => ({ crn: n, subject: "COSC", number: n, section: "01", title: n });
    mockPrisma.courseOffering.findMany.mockResolvedValueOnce([course("1"), course("2"), course("3")]);
    const first = await runSearchTimetableCourses("u1", { termId: "t1", q: "cosc", limit: 2 });
    expect(first.courses.map((c) => c.crn)).toEqual(["1", "2"]);
    expect(first.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(mockPrisma.courseOffering.findMany.mock.calls[0][0]).toMatchObject({
      skip: 0,
      take: 3,
      orderBy: [{ subject: "asc" }, { number: "asc" }, { section: "asc" }, { id: "asc" }],
    });

    mockPrisma.courseOffering.findMany.mockResolvedValueOnce([course("3")]);
    const second = await runSearchTimetableCourses("u1", {
      termId: "t1",
      q: "cosc",
      limit: 2,
      cursor: first.page.nextCursor!,
    });
    expect(mockPrisma.courseOffering.findMany.mock.calls[1][0]).toMatchObject({ skip: 2, take: 3 });
    expect(second.courses.map((c) => c.crn)).toEqual(["3"]);
    expect(second.page).toMatchObject({ nextCursor: null, hasMore: false });
  });

  it("defaults to 20 per page", async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([]);
    const out = await runSearchTimetableCourses("u1", { termId: "t1", q: "cosc" });
    expect(out.page.limit).toBe(20);
    expect(mockPrisma.courseOffering.findMany.mock.calls[0][0].take).toBe(21);
  });

  it("returns empty array when no matches", async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([]);
    const out = await runSearchTimetableCourses("u1", { termId: "t1", q: "xyz99" });
    expect(out.courses).toHaveLength(0);
  });
});
