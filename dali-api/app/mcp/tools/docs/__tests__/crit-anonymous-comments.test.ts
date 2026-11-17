import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn(), isLabMemberOrAlum: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/resource-hub.server", () => ({ canEditResourceHub: vi.fn(), ledDomainIds: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/collabAuth.server", () => ({
  hydrateAuthors: vi.fn().mockResolvedValue([
    { id: "poster", name: "Ada Lovelace", photoUrl: "/ada.png" },
    { id: "u2", name: "Leo Brennan", photoUrl: null },
  ]),
}));

import { prisma } from "~/lib/db.server";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canEditResourceHub, ledDomainIds } from "~/lib/resource-hub.server";
import { runListComments } from "~/mcp/tools/docs/comments";

const db = prisma as any;
const row = (id: string, authorId: string, parentId: string | null = null) => ({
  id, parentId, authorId, body: "hi", anchor: null, createdAt: new Date(0), updatedAt: new Date(0), versionId: null,
  reactions: [{ userId: "poster", emoji: "👍", createdAt: new Date(0) }],
});
const list = (caller: string) => runListComments(caller, { targetType: "crit", targetId: "s1" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserRoles).mockResolvedValue([] as any);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(isLabMember).mockResolvedValue(true);
  vi.mocked(isCore).mockResolvedValue(false);
  vi.mocked(canEditResourceHub).mockResolvedValue(false);
  vi.mocked(ledDomainIds).mockResolvedValue([]);
  db.critSubmission.findUnique.mockResolvedValue({
    id: "s1", kind: "image", title: "Logo", authorId: "poster", domainId: "d1", anonymous: true,
    domain: { resourceHubPage: { id: "hub1", domainId: "d1", createdById: "x", publishedAt: new Date(0) } },
  });
  db.docComment.findMany.mockImplementation(async (q: any) => (q.where.parentId === null || q.where.AND ? [row("c1", "poster"), row("c2", "u2")] : [row("c3", "poster", "c1")]));
  db.docComment.count.mockResolvedValue(2);
});

describe("list_comments on an anonymous Crit Wall post", () => {
  it("shows other members the poster's comments, replies and reactions as Anonymous", async () => {
    const { comments } = await list("u2");
    expect(comments.map((c) => c.author)).toEqual(["Anonymous", "Anonymous", "Leo Brennan"]);
    expect(comments.every((c) => c.authorId !== "poster")).toBe(true);
    const wire = JSON.stringify(comments);
    expect(wire).not.toContain("poster");
    expect(wire).not.toContain("Ada");
    expect(wire).not.toContain("ada.png");
  });

  it("shows the poster, Core and the domain's leads the real identity", async () => {
    expect((await list("poster")).comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await list("core")).comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(ledDomainIds).mockResolvedValue(["d1"]);
    expect((await list("lead")).comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
  });

  it("leaves a named post alone", async () => {
    db.critSubmission.findUnique.mockResolvedValue({ ...(await db.critSubmission.findUnique()), anonymous: false });
    expect((await list("u2")).comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
  });
});
