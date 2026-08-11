import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { resolveReferenceOptions } from "~/forms/lib/reference-sources";

const findMany = prisma.project.findMany as ReturnType<typeof vi.fn>;
const pageFindMany = prisma.page.findMany as ReturnType<typeof vi.fn>;

function projectRow(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "Alpha",
    description: "A blurb.",
    partners: [],
    domainScopes: [],
    projectTerms: [{ termId: "t1", term: { sortKey: 20254 } }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([projectRow()]);
  pageFindMany.mockResolvedValue([]);
  (prisma.term.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "t1",
    code: "25F",
  });
});

// Private projects must never be offered as an answer on a form that queries
// the project database — for any filling member, Core included.
describe("projects:* reference sources exclude private projects", () => {
  it.each([
    ["projects:open-this-term", undefined],
    ["projects:active", undefined],
    ["projects:active-in-term", { termId: "t1" }],
  ] as const)("%s filters on isPrivate: false", async (key, ctx) => {
    const options = await resolveReferenceOptions(key, ctx);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ isPrivate: false });
    expect(options.map((o) => o.value)).toEqual(["p1"]);
  });

  it("keeps the existing non-archived filter alongside it", async () => {
    await resolveReferenceOptions("projects:active");
    expect(findMany.mock.calls[0][0].where).toEqual({
      isPrivate: false,
      status: { not: "Archived" },
    });
  });
});

// Project options carry a card so the fill UI can show what's being picked.
// Challenges are narrowed to the source's term; the SOW is not term-scoped.
describe("projects:* option cards", () => {
  const richRow = {
    id: "p1",
    name: "Alpha",
    description: "A blurb.",
    partners: [{ partnerOrg: { name: "Acme" } }],
    domainScopes: [
      { termId: "t1", scope: "Ship the app", domain: { name: "Dev" } },
      { termId: "t1", scope: "Design it", domain: { name: "Design" } },
      { termId: "t-other", scope: "Old work", domain: { name: "Dev" } },
      { termId: "t1", scope: "   ", domain: { name: "PM" } },
    ],
    projectTerms: [
      { termId: "t1", term: { sortKey: 20254 } },
      { termId: "t-other", term: { sortKey: 20251 } },
    ],
  };

  it("builds the card from the scoped term, alphabetical by domain", async () => {
    findMany.mockResolvedValue([richRow]);
    pageFindMany.mockResolvedValue([{ id: "page-1", workspaceId: "p1" }]);
    const [option] = await resolveReferenceOptions("projects:active-in-term", {
      termId: "t1",
    });

    expect(option.card).toEqual({
      description: "A blurb.",
      imageUrl: null,
      partners: ["Acme"],
      challenges: [
        { domain: "Design", scope: "Design it" },
        { domain: "Dev", scope: "Ship the app" },
      ],
      sowPageId: "page-1",
    });
  });

  it("requests only current partnerships", async () => {
    await resolveReferenceOptions("projects:active");
    expect(findMany.mock.calls[0][0].select.partners.where).toEqual({
      endedAt: null,
    });
  });

  it("falls back to the project's latest term when the source has none", async () => {
    findMany.mockResolvedValue([richRow]);
    const [option] = await resolveReferenceOptions("projects:active");

    expect(option.card?.challenges).toHaveLength(2);
  });

  it("omits blank challenges and yields an empty card for a bare project", async () => {
    findMany.mockResolvedValue([projectRow()]);
    const [option] = await resolveReferenceOptions("projects:active");

    expect(option.card).toEqual({
      description: "A blurb.",
      imageUrl: null,
      partners: [],
      challenges: [],
      sowPageId: null,
    });
  });

  it("resolves the SOW from the project document tagged 'sow'", async () => {
    findMany.mockResolvedValue([projectRow(), projectRow({ id: "p2", name: "Beta" })]);
    pageFindMany.mockResolvedValue([
      { id: "sow-a", workspaceId: "p1" },
      { id: "sow-b", workspaceId: "p2" },
    ]);

    const options = await resolveReferenceOptions("projects:active");

    // One query for the whole list, not one per card.
    expect(pageFindMany).toHaveBeenCalledTimes(1);
    const where = pageFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      workspaceType: "Project",
      workspaceId: { in: ["p1", "p2"] },
      archivedAt: null,
      isTemplate: false,
    });
    expect(where.tags.some.tag).toMatchObject({ slug: "sow" });
    expect(options.map((o) => o.card?.sowPageId)).toEqual(["sow-a", "sow-b"]);
  });

  it("takes the first tagged document in page order when a project has several", async () => {
    findMany.mockResolvedValue([projectRow()]);
    pageFindMany.mockResolvedValue([
      { id: "sow-first", workspaceId: "p1" },
      { id: "sow-second", workspaceId: "p1" },
    ]);

    const [option] = await resolveReferenceOptions("projects:active");

    expect(pageFindMany.mock.calls[0][0].orderBy).toEqual([
      { position: "asc" },
      { createdAt: "asc" },
    ]);
    expect(option.card?.sowPageId).toBe("sow-first");
  });

  it("leaves sowPageId null when no document carries the tag", async () => {
    findMany.mockResolvedValue([projectRow()]);
    pageFindMany.mockResolvedValue([]);

    const [option] = await resolveReferenceOptions("projects:active");

    expect(option.card?.sowPageId).toBeNull();
  });

  it("leaves domain sources plain — no card", async () => {
    (prisma.domain.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "d1", displayName: "Dev" },
    ]);
    const options = await resolveReferenceOptions("domains:active");
    expect(options).toEqual([{ value: "d1", label: "Dev" }]);
  });
});
