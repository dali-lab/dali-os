import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    projectShowcase: { findMany: vi.fn(), findFirst: vi.fn() },
    projectAssignment: { findMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import {
  listPublicProjects,
  getPublicProject,
} from "~/public-api/lib/public-projects.server";

const mockPrisma = prisma as unknown as {
  projectShowcase: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  projectAssignment: { findMany: ReturnType<typeof vi.fn> };
};

const showcaseRow = {
  projectId: "p1",
  displayName: "Evergreen",
  tagline: "Evergreen 26W",
  year: 2026,
  partners: ["Dartmouth College", "Dartmouth-Hitchcock Medical Center"],
  products: ["Mobile"],
  sectors: ["Health"],
  techStack: ["Flutter"],
  appUrl: null,
  websiteUrl: null,
  blogUrl: null,
  pressUrl: null,
  heroImageUrl: null,
  details: null,
  media: null,
  project: { id: "p1", name: "Evergreen", imageUrl: null },
};

const assignmentRows = [
  { projectId: "p1", user: { id: "u1", firstName: "Ali", lastName: "Azam" } },
  { projectId: "p1", user: { id: "u2", firstName: "Cole", lastName: "Yasuda" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.projectShowcase.findMany.mockResolvedValue([showcaseRow]);
  mockPrisma.projectShowcase.findFirst.mockResolvedValue(showcaseRow);
  mockPrisma.projectAssignment.findMany.mockResolvedValue(assignmentRows);
});

// The site renders partners and the student roster as two separate sections.
// Collapsing them — in either direction — credits the wrong people.
describe("partners and team members stay distinct", () => {
  it("ships the curated partner list on the list endpoint", async () => {
    const [project] = await listPublicProjects();
    expect(project.partners).toEqual([
      "Dartmouth College",
      "Dartmouth-Hitchcock Medical Center",
    ]);
    expect(project.teamMembers).toEqual(["Ali Azam", "Cole Yasuda"]);
  });

  it("ships the curated partner list on the detail endpoint", async () => {
    const result = await getPublicProject("p1");
    expect(result?.project.partners).toEqual([
      "Dartmouth College",
      "Dartmouth-Hitchcock Medical Center",
    ]);
    expect(result?.project.teamMembers).toEqual(["Ali Azam", "Cole Yasuda"]);
  });

  // `tags` is the site's filter vocabulary. Partner names are credits, not
  // facets, so they stay out of it.
  it("keeps partners out of the filter tags", async () => {
    const [project] = await listPublicProjects();
    expect(project.tags).toEqual(["Mobile", "Health", "Flutter"]);
  });
});
