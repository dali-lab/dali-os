import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/resource-hub/lib/resource-hub.server", () => ({ requireResourceHubViewer: vi.fn() }));
vi.mock("~/lib/link-preview.server", () => ({ fetchLinkPreview: vi.fn() }));

import { requireResourceHubViewer } from "~/resource-hub/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { _resetForTests } from "~/lib/rate-limit";
import { action } from "~/routes/api.link-preview";

const post = (userId = "u1") => {
  vi.mocked(requireResourceHubViewer).mockResolvedValue({ user: { sub: userId }, core: false, userName: "Ada" } as any);
  const body = new FormData();
  body.set("url", "https://example.com");
  return action({ request: new Request("http://localhost/api/link-preview", { method: "POST", body }), params: {}, context: {} } as any) as Promise<Response>;
};

beforeEach(() => {
  vi.resetAllMocks();
  _resetForTests();
  vi.mocked(fetchLinkPreview).mockResolvedValue({ title: "T", image: null, description: null });
});

describe("POST /api/link-preview", () => {
  it("returns the preview", async () => {
    expect(await (await post()).json()).toEqual({ title: "T", image: null, description: null });
  });
  it("429s a user past the limit without fetching, and leaves other users alone", async () => {
    for (let i = 0; i < 20; i++) await post();
    vi.mocked(fetchLinkPreview).mockClear();
    const res = await post();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(fetchLinkPreview).not.toHaveBeenCalled();
    expect((await post("u2")).status).toBe(200);
  });
});
