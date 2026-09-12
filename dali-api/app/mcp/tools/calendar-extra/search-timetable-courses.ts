// MCP `search_timetable_courses` — search the Dartmouth timetable course cache.
// Reuses the Prisma query from api.timetable.courses.ts loader.
// Requires `mcp:read` scope.

import { prisma } from "~/lib/db";
import { McpInvalidError } from "../../registry";

const LIMIT = 20;

export const SEARCH_TIMETABLE_COURSES_DEF = {
  name: "search_timetable_courses",
  description:
    "Search the Dartmouth timetable course cache for a given term. Returns up to 20 matching course sections with period, location, and enrollment info. Use the returned CRN, subject, courseNumber, and section when calling manage_class.",
  inputSchema: {
    type: "object" as const,
    properties: {
      termId: {
        type: "string",
        minLength: 1,
        description: "Term.id to search within.",
      },
      q: {
        type: "string",
        minLength: 2,
        description: "Search text (minimum 2 characters) — matched against subject, number, and title.",
      },
    },
    required: ["termId", "q"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { termId: string; q: string };

export async function runSearchTimetableCourses(_userId: string, input: Input) {
  if (input.q.length < 2) {
    throw new McpInvalidError("Query must be at least 2 characters");
  }

  const courses = await prisma.courseOffering.findMany({
    where: {
      termId: input.termId,
      searchText: { contains: input.q.toLowerCase() },
    },
    orderBy: [{ subject: "asc" }, { number: "asc" }, { section: "asc" }],
    take: LIMIT,
    select: {
      crn: true,
      subject: true,
      number: true,
      section: true,
      title: true,
      periodCode: true,
      periodText: true,
      building: true,
      room: true,
      instructor: true,
      crosslist: true,
      distributive: true,
      enrollLimit: true,
      enrollCurrent: true,
    },
  });

  return { courses };
}
