import { describe, it, expect, beforeEach, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  projectShowcase: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: vi.fn(async (v: string | null) =>
    v && v !== "uploads/broken" ? `signed:${v}` : null,
  ),
}));
vi.mock("~/public-api/lib/public-projects.server", () => ({
  teamMembersByProject: vi.fn(async () => new Map([["p1", ["Ada Lovelace", "Grace Hopper"]]])),
}));

import { listShowcaseCards, getShowcaseView } from "~/projects/lib/showcase-view.server";

const ROW = {
  projectId: "p1",
  displayName: "Beacon Public",
  tagline: "Wayfinding for campus",
  year: 2026,
  partners: ["Acme"],
  heroImageUrl: "uploads/hero",
  project: { name: "Beacon", imageUrl: "uploads/banner" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listShowcaseCards", () => {
  it("lists published showcases newest year first, capped to the limit", async () => {
    prisma.projectShowcase.findMany.mockResolvedValue([ROW]);
    const cards = await listShowcaseCards(6);
    expect(prisma.projectShowcase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "Published" },
        orderBy: [{ year: "desc" }, { tagline: "asc" }],
        take: 6,
      }),
    );
    expect(cards).toEqual([
      {
        id: "p1",
        name: "Beacon Public",
        tagline: "Wayfinding for campus",
        year: 2026,
        partners: ["Acme"],
        coverUrl: "signed:uploads/hero",
      },
    ]);
  });

  it("falls back to the internal name and banner when the public fields are unset", async () => {
    prisma.projectShowcase.findMany.mockResolvedValue([
      { ...ROW, displayName: null, tagline: null, heroImageUrl: null },
    ]);
    const [card] = await listShowcaseCards(6);
    expect(card.name).toBe("Beacon");
    expect(card.tagline).toBe("");
    expect(card.coverUrl).toBe("signed:uploads/banner");
  });
});

describe("getShowcaseView", () => {
  const DETAIL_ROW = {
    ...ROW,
    products: ["Mobile app"],
    sectors: ["Education"],
    techStack: ["React"],
    appUrl: "https://app.example",
    websiteUrl: "https://site.example",
    blogUrl: null,
    pressUrl: null,
    details: [
      { item: "The Problem", description: "Getting lost" },
      { item: "", description: "" },
    ],
    media: [
      { type: "image", src: "uploads/shot", caption: "Home screen" },
      { type: "image", src: "uploads/broken" },
      { type: "video", src: "https://cdn.example/demo.mp4" },
    ],
  };

  it("returns null for a project with no published showcase", async () => {
    prisma.projectShowcase.findFirst.mockResolvedValue(null);
    expect(await getShowcaseView("p9")).toBeNull();
    expect(prisma.projectShowcase.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: "p9", status: "Published" } }),
    );
  });

  it("assembles the public view: links, team, parsed details, resolvable media only", async () => {
    prisma.projectShowcase.findFirst.mockResolvedValue(DETAIL_ROW);
    const view = await getShowcaseView("p1");
    expect(view).toMatchObject({
      id: "p1",
      name: "Beacon Public",
      products: ["Mobile app"],
      sectors: ["Education"],
      techStack: ["React"],
      teamMembers: ["Ada Lovelace", "Grace Hopper"],
    });
    expect(view?.links).toEqual([
      { label: "Website", url: "https://site.example" },
      { label: "App", url: "https://app.example" },
    ]);
    expect(view?.details).toEqual([{ item: "The Problem", description: "Getting lost" }]);
    expect(view?.media).toEqual([
      { type: "image", url: "signed:uploads/shot", caption: "Home screen" },
      { type: "video", url: "signed:https://cdn.example/demo.mp4" },
    ]);
  });
});
