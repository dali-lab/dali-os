import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/resources.server", () => ({ requireResourcesViewer: vi.fn() }));
vi.mock("~/lib/blog-post.server", () => ({ loadBlogFeedPage: vi.fn() }));

import { requireResourcesViewer } from "~/lib/resources.server";
import { loadBlogFeedPage } from "~/lib/blog-post.server";
import { loader } from "~/routes/api.resources.blog-posts";

function call(query = "") {
  const request = new Request(`http://localhost/api/resources/blog-posts${query}`);
  return loader({ request, params: {}, context: {} } as any) as Promise<Response>;
}

describe("GET /api/resources/blog-posts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourcesViewer).mockResolvedValue({ user: { sub: "u1" }, core: false } as any);
    vi.mocked(loadBlogFeedPage).mockResolvedValue({ items: [], nextCursor: null });
  });

  it("runs the same viewer gate as the front page and loads nothing when it throws", async () => {
    vi.mocked(requireResourcesViewer).mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(loadBlogFeedPage).not.toHaveBeenCalled();
  });

  it("loads the first page for the viewer without a cursor", async () => {
    await call();
    expect(loadBlogFeedPage).toHaveBeenCalledWith("u1", null);
  });

  it("passes the cursor through and returns the page as JSON", async () => {
    vi.mocked(loadBlogFeedPage).mockResolvedValue({ items: [], nextCursor: "x|y" });
    const res = await call("?cursor=2026-10-01T00:00:00.000Z%7Cp1");
    expect(loadBlogFeedPage).toHaveBeenCalledWith("u1", "2026-10-01T00:00:00.000Z|p1");
    expect(await res.json()).toEqual({ items: [], nextCursor: "x|y" });
  });
});
