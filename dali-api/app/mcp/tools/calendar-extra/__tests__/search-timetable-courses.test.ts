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

  it("returns empty array when no matches", async () => {
    mockPrisma.courseOffering.findMany.mockResolvedValue([]);
    const out = await runSearchTimetableCourses("u1", { termId: "t1", q: "xyz99" });
    expect(out.courses).toHaveLength(0);
  });
});
