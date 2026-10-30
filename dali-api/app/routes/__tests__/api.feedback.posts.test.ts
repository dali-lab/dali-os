import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/feedback.server", () => ({ requireFeedbackViewer: vi.fn() }));
vi.mock("~/lib/feedback-feed.server", () => ({
  loadFeedbackPage: vi.fn(),
  loadFeedbackPostsByIds: vi.fn(),
}));

import { requireFeedbackViewer } from "~/lib/feedback.server";
import { loadFeedbackPage, loadFeedbackPostsByIds } from "~/lib/feedback-feed.server";
import { loader } from "~/routes/api.feedback.posts";

function call(qs = "") {
  return loader({ request: new Request(`http://localhost/api/feedback/posts${qs}`), params: {}, context: {} } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireFeedbackViewer).mockResolvedValue({ user: { sub: "ada" }, core: true } as never);
  vi.mocked(loadFeedbackPage).mockResolvedValue({ items: [], nextCursor: null } as never);
  vi.mocked(loadFeedbackPostsByIds).mockResolvedValue([{ id: "p1" }] as never);
});

describe("api.feedback.posts", () => {
  it("runs the os-feedback gate first and lets its rejection through", async () => {
    vi.mocked(requireFeedbackViewer).mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(loadFeedbackPage).not.toHaveBeenCalled();
  });

  it("loads the page after a cursor for the viewer", async () => {
    await call("?cursor=abc");
    expect(loadFeedbackPage).toHaveBeenCalledWith("abc", { userId: "ada", core: true });
  });

  it("re-reads posts by id", async () => {
    const res = await call("?ids=p1,,p2");
    expect(loadFeedbackPostsByIds).toHaveBeenCalledWith(["p1", "p2"], { userId: "ada", core: true });
    expect(await res.json()).toEqual({ items: [{ id: "p1" }], nextCursor: null });
    expect(loadFeedbackPage).not.toHaveBeenCalled();
  });
});
