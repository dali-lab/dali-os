import { beforeEach, describe, expect, it, vi } from "vitest";

const viewerLib = vi.hoisted(() => ({
  requireOpportunityViewer: vi.fn(),
  requireOpportunityViewerEnabled: vi.fn(),
  canPostJob: (v: { core: boolean; alumni: boolean }) => v.core || v.alumni,
}));
const feed = vi.hoisted(() => ({
  loadOpportunitiesPage: vi.fn(),
  loadOpportunityPage: vi.fn(),
  loadOpportunityPostsByIds: vi.fn(),
  loadViewerMatchProfile: vi.fn(async () => ({ askMeAbout: [] })),
  parseShow: (v: string | null) => (v === "jobs" || v === "chats" ? v : "all"),
}));
const actions = vi.hoisted(() => ({ runOpportunityAction: vi.fn() }));

vi.mock("~/community/lib/opportunities-viewer.server", () => viewerLib);
vi.mock("~/community/lib/opportunities-feed.server", () => feed);
vi.mock("~/community/lib/opportunities-actions.server", () => actions);
vi.mock("~/community/components/opportunities/OpportunitiesView", () => ({ OpportunitiesView: () => null }));
vi.mock("~/components/ComingSoon", () => ({ ComingSoon: () => null }));

import { loader, action } from "../community.opportunities";
import { loader as apiLoader } from "../api.opportunities.posts";

const viewer = { userId: "me", core: false, alumni: true };

beforeEach(() => {
  vi.clearAllMocks();
  viewerLib.requireOpportunityViewer.mockResolvedValue({ viewer, enabled: true });
  viewerLib.requireOpportunityViewerEnabled.mockResolvedValue(viewer);
  feed.loadOpportunitiesPage.mockResolvedValue({ items: [], pinned: [], nextCursor: null });
});

describe("page loader", () => {
  it("returns the ComingSoon marker and loads nothing when the flag is off", async () => {
    viewerLib.requireOpportunityViewer.mockResolvedValue({ viewer, enabled: false });
    expect(await loader({ request: new Request("http://x/community/opportunities") } as never)).toEqual({ enabled: false });
    expect(feed.loadOpportunitiesPage).not.toHaveBeenCalled();
  });

  it("loads the feed with the Show param and whether the viewer can post jobs", async () => {
    const result = await loader({ request: new Request("http://x/community/opportunities?show=jobs") } as never);
    expect(feed.loadOpportunitiesPage).toHaveBeenCalledWith(null, viewer, "jobs");
    expect(result).toMatchObject({ enabled: true, canPostJob: true });
  });

  it("says students can't post jobs", async () => {
    viewerLib.requireOpportunityViewer.mockResolvedValue({ viewer: { ...viewer, alumni: false }, enabled: true });
    const result = await loader({ request: new Request("http://x/community/opportunities") } as never);
    expect(result).toMatchObject({ canPostJob: false });
  });
});

describe("page action", () => {
  const post = () => new Request("http://x/community/opportunities", { method: "POST", body: new FormData() });

  it("passes success through", async () => {
    actions.runOpportunityAction.mockResolvedValue({ ok: true });
    expect(await action({ request: post() } as never)).toEqual({ ok: true });
  });

  it("returns the failure status as data", async () => {
    actions.runOpportunityAction.mockResolvedValue({ ok: false, status: 403 });
    const result = (await action({ request: post() } as never)) as { init: { status: number } };
    expect(result.init.status).toBe(403);
  });

  it("is a 404 when the flag is off", async () => {
    viewerLib.requireOpportunityViewerEnabled.mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(action({ request: post() } as never)).rejects.toBeInstanceOf(Response);
    expect(actions.runOpportunityAction).not.toHaveBeenCalled();
  });
});

describe("api loader", () => {
  it("pages by cursor and show", async () => {
    feed.loadOpportunityPage.mockResolvedValue({ items: [{ id: "a" }], pinned: [], nextCursor: "c2" });
    const res = await apiLoader({ request: new Request("http://x/api/opportunities/posts?cursor=c1&show=chats") } as never);
    expect(feed.loadOpportunityPage).toHaveBeenCalledWith("c1", viewer, expect.objectContaining({ show: "chats" }));
    expect(await res.json()).toEqual({ items: [{ id: "a" }], nextCursor: "c2" });
  });

  it("re-reads posts by ids", async () => {
    feed.loadOpportunityPostsByIds.mockResolvedValue([{ id: "a" }]);
    const res = await apiLoader({ request: new Request("http://x/api/opportunities/posts?ids=a,b") } as never);
    expect(feed.loadOpportunityPostsByIds).toHaveBeenCalledWith(["a", "b"], viewer, expect.anything());
    expect(await res.json()).toEqual({ items: [{ id: "a" }], nextCursor: null });
  });

  it("404s when the flag is off", async () => {
    viewerLib.requireOpportunityViewerEnabled.mockRejectedValue(new Response("Not found", { status: 404 }));
    await expect(apiLoader({ request: new Request("http://x/api/opportunities/posts") } as never)).rejects.toBeInstanceOf(Response);
  });
});
