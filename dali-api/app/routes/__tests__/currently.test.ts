import { describe, it, expect, beforeEach, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  project: { findMany: vi.fn(), count: vi.fn() },
  blogPost: { findMany: vi.fn(), count: vi.fn() },
  user: { count: vi.fn() },
  projectPartner: { findMany: vi.fn() },
  timeEntry: { aggregate: vi.fn() },
  galleryPost: { count: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  getUserRoles: vi.fn(),
  currentTerm: vi.fn(),
  currentTermMemberWhere: vi.fn(),
}));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/photo", () => ({
  resolvePhotoUrl: vi.fn(async (key: string | null) => (key ? `signed:${key}` : null)),
}));
vi.mock("~/lib/blog-post.server", () => ({ BLOG_LISTING_ORDER: [{ publishedAt: "desc" }] }));
vi.mock("~/community/lib/gallery.server", () => ({ loadGalleryHighlights: vi.fn() }));
vi.mock("~/projects/lib/showcase-view.server", () => ({ listShowcaseCards: vi.fn() }));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { getUserRoles, currentTerm, currentTermMemberWhere } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { loadGalleryHighlights } from "~/community/lib/gallery.server";
import { listShowcaseCards } from "~/projects/lib/showcase-view.server";
import { loader } from "~/routes/currently";

const run = () =>
  loader({
    request: new Request("http://localhost/currently"),
    params: {},
    context: {},
  } as never) as Promise<any>;

const TILE = { id: "g1", imageUrl: "https://img/thumb" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(getUserRoles).mockResolvedValue({ isAlumni: false, isCore: false } as never);
  vi.mocked(currentTerm).mockResolvedValue({
    id: "t1",
    code: "26F",
    startDate: new Date("2026-09-14T00:00:00Z"),
    endDate: new Date("2026-11-24T00:00:00Z"),
  } as never);
  vi.mocked(currentTermMemberWhere).mockResolvedValue({ membershipStatus: "Active" } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(loadGalleryHighlights).mockResolvedValue([TILE] as never);
  vi.mocked(listShowcaseCards).mockResolvedValue([] as never);
  prisma.user.count.mockResolvedValue(74);
  prisma.project.count.mockResolvedValue(18);
  prisma.projectPartner.findMany.mockResolvedValue([
    { partnerOrgId: "o1" },
    { partnerOrgId: "o2" },
  ]);
  prisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: 1234.4 } });
  prisma.galleryPost.count.mockResolvedValue(321);
  prisma.project.findMany.mockResolvedValue([
    {
      id: "p1",
      name: "Beacon",
      iconEmoji: "🛰️",
      status: "Active",
      imageUrl: "cover-key",
      projectTerms: [{ term: { code: "25W" } }],
      partners: [{ partnerOrg: { name: "Acme", logoUrl: null } }],
      showcase: { status: "Published" },
    },
  ]);
  prisma.blogPost.findMany.mockResolvedValue([
    {
      id: "b1",
      title: "Shipping week",
      summary: "A short recap.",
      excerpt: "Long body excerpt",
      customCoverUrl: null,
      coverImageUrl: "/cover.png",
      visibility: "Public",
      publishedAt: new Date("2026-11-01T12:00:00Z"),
      author: { firstName: "Ada", lastName: "Lovelace" },
    },
  ]);
  prisma.blogPost.count.mockResolvedValue(12);
});

describe("Currently at DALI loader", () => {
  it("returns this term's active projects shaped for the project card", async () => {
    const data = await run();
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "Active", projectTerms: { some: { termId: "t1" } } },
        take: 6,
      }),
    );
    expect(data.termCode).toBe("26F");
    expect(data.projects).toEqual([
      {
        id: "p1",
        name: "Beacon",
        iconEmoji: "🛰️",
        status: "Active",
        firstTermCode: "25W",
        imageUrl: "signed:cover-key",
        partners: [{ name: "Acme", logoUrl: null }],
        showcaseStatus: "Published",
      },
    ]);
  });

  it("lists all active projects when no current term is known", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    await run();
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "Active" } }),
    );
  });

  it("maps stories to their listing shape with the published total", async () => {
    const data = await run();
    expect(data.stories).toEqual([
      expect.objectContaining({
        id: "b1",
        title: "Shipping week",
        excerpt: "A short recap.",
        coverImageUrl: "/cover.png",
        isPublic: true,
        author: "Ada Lovelace",
      }),
    ]);
    expect(data.storiesTotal).toBe(12);
  });

  it("reads gallery highlights as the signed-in viewer", async () => {
    const data = await run();
    expect(loadGalleryHighlights).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", core: false }),
      8,
    );
    expect(data.gallery).toEqual([TILE]);
  });

  it("skips the stories and gallery reads entirely while the community flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const data = await run();
    expect(data.community).toBe(false);
    expect(data.stories).toEqual([]);
    expect(data.gallery).toEqual([]);
    expect(data.storiesTotal).toBe(0);
    expect(prisma.blogPost.findMany).not.toHaveBeenCalled();
    expect(prisma.blogPost.count).not.toHaveBeenCalled();
    expect(loadGalleryHighlights).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = await run();
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
  });

  it("sends a non-member to the portal", async () => {
    const portal = new Response(null, { status: 302, headers: { Location: "/portal" } });
    vi.mocked(redirectNonMemberToPortal).mockResolvedValue(portal as never);
    const res = await run();
    expect(res).toBe(portal);
  });

  it("gives an alumni viewer showcase cards instead of internal projects", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ isAlumni: true, isCore: false } as never);
    const card = { id: "p1", name: "Beacon", tagline: "A thing", year: 2026, partners: [], coverUrl: null };
    vi.mocked(listShowcaseCards).mockResolvedValue([card] as never);
    const data = await run();
    expect(data.alumni).toBe(true);
    expect(data.showcaseProjects).toEqual([card]);
    expect(data.projects).toEqual([]);
    expect(listShowcaseCards).toHaveBeenCalledWith(6);
    expect(prisma.project.findMany).not.toHaveBeenCalled();
  });

  it("leaves showcase cards unloaded for a member viewer", async () => {
    const data = await run();
    expect(data.alumni).toBe(false);
    expect(data.showcaseProjects).toEqual([]);
    expect(listShowcaseCards).not.toHaveBeenCalled();
  });

  it("counts members, projects, distinct partners, hours and photos for the stat row", async () => {
    const data = await run();
    expect(data.stats).toEqual({
      members: 74,
      projects: 18,
      partners: 2,
      hours: 1234,
      photos: 321,
    });
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { membershipStatus: "Active" } });
    expect(prisma.project.count).toHaveBeenCalledWith({
      where: { status: "Active", projectTerms: { some: { termId: "t1" } } },
    });
    expect(prisma.projectPartner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ["partnerOrgId"] }),
    );
    expect(prisma.timeEntry.aggregate).toHaveBeenCalledWith({
      _sum: { hours: true },
      where: {
        date: {
          gte: new Date("2026-09-14T00:00:00Z"),
          lte: new Date("2026-11-24T00:00:00Z"),
        },
      },
    });
  });

  it("skips term-scoped hours and keeps photos private while term and community are off", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const data = await run();
    expect(data.stats.hours).toBeNull();
    expect(data.stats.photos).toBe(0);
    expect(prisma.timeEntry.aggregate).not.toHaveBeenCalled();
    expect(prisma.galleryPost.count).not.toHaveBeenCalled();
  });
});
