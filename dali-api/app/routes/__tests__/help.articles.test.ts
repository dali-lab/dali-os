import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  getUserRoles: vi.fn(),
  visibleHelpArticles: vi.fn(),
  findHelpArticle: vi.fn(),
}));
vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: h.requireAuth, isNonMember: h.isNonMember }));
vi.mock("~/lib/roles", () => ({ getUserRoles: h.getUserRoles }));
vi.mock("~/help/library.server", () => ({
  visibleHelpArticles: h.visibleHelpArticles,
  findHelpArticle: h.findHelpArticle,
}));

import { loader as listLoader } from "../help.articles._index";
import { loader as articleLoader } from "../help.articles.$slug";

const ROLES = { isLabMember: true };
const article = (slug: string, url = `/help/articles/${slug}`) => ({
  slug,
  title: `Title ${slug}`,
  summary: "Summary.",
  url,
  body: "## Body",
  audience: [],
  flag: null,
  paths: [],
  keywords: [],
});

const call = <T>(fn: (args: never) => T, path: string, params: Record<string, string> = {}) =>
  fn({ request: new Request(`http://localhost${path}`), params, context: {} } as never);

async function thrown(p: unknown): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the loader to throw");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  h.isNonMember.mockResolvedValue(false);
  h.getUserRoles.mockResolvedValue(ROLES);
});

describe("/help/articles", () => {
  it("lists the articles this member can see", async () => {
    h.visibleHelpArticles.mockResolvedValue([article("rooms")]);
    const result = await call(listLoader, "/help/articles");
    expect(result).toEqual({
      articles: [{ slug: "rooms", title: "Title rooms", summary: "Summary.", url: "/help/articles/rooms" }],
    });
    expect(h.visibleHelpArticles).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", roles: ROLES }));
  });

  it("sends someone outside the lab to the portal", async () => {
    h.isNonMember.mockResolvedValue(true);
    const res = (await call(listLoader, "/help/articles")) as Response;
    expect(res.headers.get("Location")).toBe("/portal");
    expect(h.visibleHelpArticles).not.toHaveBeenCalled();
  });
});

describe("/help/articles/:slug", () => {
  it("returns the article", async () => {
    h.findHelpArticle.mockResolvedValue(article("rooms"));
    expect(await call(articleLoader, "/help/articles/rooms", { slug: "rooms" })).toEqual({
      title: "Title rooms",
      summary: "Summary.",
      body: "## Body",
    });
    expect(h.findHelpArticle).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }), "rooms");
  });

  it("is a 404 for an article this member can't see", async () => {
    h.findHelpArticle.mockResolvedValue(null);
    const e = (await thrown(call(articleLoader, "/help/articles/running-staffing", { slug: "running-staffing" }))) as {
      init: { status: number };
    };
    expect(e.init.status).toBe(404);
  });

  it("redirects an article that lives on its own page", async () => {
    h.findHelpArticle.mockResolvedValue(article("shortcuts", "/help/shortcuts"));
    const res = (await call(articleLoader, "/help/articles/shortcuts", { slug: "shortcuts" })) as Response;
    expect(res.headers.get("Location")).toBe("/help/shortcuts");
  });
});
