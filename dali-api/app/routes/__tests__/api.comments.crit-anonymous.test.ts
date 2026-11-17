import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(), isCore: vi.fn(), isLabMember: vi.fn(), isLabMemberOrAlum: vi.fn(), isProjectMember: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/resource-hub.server", () => ({ canEditResourceHub: vi.fn(), ledDomainIds: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_req: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/collabAuth.server", () => ({
  hydrateAuthors: vi.fn().mockResolvedValue([
    { id: "poster", name: "Ada Lovelace", photoUrl: "/ada.png" },
    { id: "u2", name: "Leo Brennan", photoUrl: null },
  ]),
}));
vi.mock("~/lib/reactions.server", () => ({ withEmojiImages: vi.fn(async (items: unknown[]) => items) }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn() }));
vi.mock("~/lib/doc-comments.server", () => ({ CommentCreateError: class extends Error {}, createDocComment: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canEditResourceHub, ledDomainIds } from "~/lib/resource-hub.server";
import { loader } from "~/routes/api.comments";

const db = prisma as any;
const as = (sub: string) => vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub, type: "member" } } as any);
const list = async () => (await ((loader({ request: new Request("http://localhost/api/comments?targetType=crit&targetId=s1"), params: {} } as any) as Promise<Response>))).json();

const row = (id: string, authorId: string, reactions: object[] = []) => ({
  id, parentId: null, authorId, body: "hi", bodyJson: null, anchor: null, createdAt: new Date(0), updatedAt: new Date(0), versionId: null, reactions,
});

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
  db.docComment.findMany.mockResolvedValue([
    row("c1", "poster", [{ userId: "poster", emoji: "👍", createdAt: new Date(0) }]),
    row("c2", "u2", [{ userId: "poster", emoji: "🎉", createdAt: new Date(0) }]),
  ]);
});

describe("GET /api/comments on an anonymous Crit Wall post", () => {
  it("shows another member the poster's comments and reactions as Anonymous, with no real id or name anywhere", async () => {
    as("u2");
    const { comments } = await list();
    expect(comments[0]).toMatchObject({ authorId: "anonymous", author: "Anonymous", authorPhotoUrl: null });
    expect(comments[1]).toMatchObject({ authorId: "u2", author: "Leo Brennan" });
    expect(comments[0].reactions[0]).toMatchObject({ userId: "anonymous", name: "Anonymous" });
    expect(comments[1].reactions[0]).toMatchObject({ userId: "anonymous", name: "Anonymous" });
    const wire = JSON.stringify(comments);
    expect(wire).not.toContain("poster");
    expect(wire).not.toContain("Ada");
    expect(wire).not.toContain("ada.png");
  });

  it("shows the poster themselves their own identity", async () => {
    as("poster");
    const { comments } = await list();
    expect(comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
  });

  it("shows Core and the domain's leads the real identity", async () => {
    as("core");
    vi.mocked(isCore).mockResolvedValue(true);
    expect((await list()).comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
    vi.mocked(isCore).mockResolvedValue(false);
    vi.mocked(ledDomainIds).mockResolvedValue(["d1"]);
    as("lead");
    expect((await list()).comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
  });

  it("leaves a named post's comments alone", async () => {
    as("u2");
    db.critSubmission.findUnique.mockResolvedValue({ ...(await db.critSubmission.findUnique()), anonymous: false });
    expect((await list()).comments[0]).toMatchObject({ authorId: "poster", author: "Ada Lovelace" });
  });
});
