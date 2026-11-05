import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/sse.server", () => ({ busEventStream: vi.fn(() => new Response("stream")) }));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: vi.fn() }));
vi.mock("~/lib/slide-live.server", async () => {
  const { z } = await import("zod");
  return {
    slideLiveTopic: (id: string) => `slide-live:${id}`,
    slidesLiveEnabled: vi.fn(),
    readLive: vi.fn(),
    applyLive: vi.fn(),
    liveIntentSchema: z.discriminatedUnion("intent", [
      z.object({ intent: z.literal("go"), slideId: z.string().min(1) }),
      z.object({ intent: z.literal("end") }),
    ]),
  };
});

import { requireAuth } from "~/lib/auth";
import { busEventStream } from "~/lib/sse.server";
import { deckAccess } from "~/lib/slide-decks.server";
import { applyLive, readLive, slidesLiveEnabled } from "~/lib/slide-live.server";
import { action, loader } from "../api.slides.$pageId.live";
import { loader as streamLoader } from "../api.slides.$pageId.live.stream";

const live = { active: true, slideId: "s1", build: 0, presenter: { id: "u1", name: "Ada" }, startedAt: "x" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(slidesLiveEnabled).mockResolvedValue(true);
});

const args = (init?: RequestInit) => ({ request: new Request("http://t/api/slides/p1/live", init), params: { pageId: "p1" } }) as never;

describe("GET /api/slides/:pageId/live", () => {
  it("returns the live state", async () => {
    vi.mocked(readLive).mockResolvedValue({ ok: true, live });
    const res = (await loader(args())) as Response;
    expect(await res.json()).toEqual(live);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("404s when the flag is off", async () => {
    vi.mocked(slidesLiveEnabled).mockResolvedValue(false);
    expect(((await loader(args())) as Response).status).toBe(404);
    expect(readLive).not.toHaveBeenCalled();
  });

  it("surfaces an access failure", async () => {
    vi.mocked(readLive).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(((await loader(args())) as Response).status).toBe(404);
  });
});

describe("POST /api/slides/:pageId/live", () => {
  const post = (body: unknown) => args({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("applies a valid intent", async () => {
    vi.mocked(applyLive).mockResolvedValue({ ok: true, live });
    const res = (await action(post({ intent: "go", slideId: "s1" }))) as Response;
    expect(res.status).toBe(200);
    expect(applyLive).toHaveBeenCalledWith("u1", "p1", { intent: "go", slideId: "s1" }, expect.any(Request));
  });

  it("returns the rejection status", async () => {
    vi.mocked(applyLive).mockResolvedValue({ ok: false, status: 403, error: "Only the presenter can move the deck." });
    expect(((await action(post({ intent: "go", slideId: "s1" }))) as Response).status).toBe(403);
  });

  it("400s on an invalid body", async () => {
    expect(((await action(post({ intent: "bogus" }))) as Response).status).toBe(400);
    expect(applyLive).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    vi.mocked(slidesLiveEnabled).mockResolvedValue(false);
    expect(((await action(post({ intent: "end" }))) as Response).status).toBe(404);
    expect(applyLive).not.toHaveBeenCalled();
  });
});

describe("GET /api/slides/:pageId/live/stream", () => {
  it("opens a busEventStream on the deck topic", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: true, page: { id: "p1", title: "T", iconEmoji: null }, canEdit: false });
    await streamLoader(args());
    expect(busEventStream).toHaveBeenCalledWith(expect.any(Request), ["slide-live:p1"], expect.any(Object));
  });

  it("404s when the flag is off or the deck is not viewable", async () => {
    vi.mocked(slidesLiveEnabled).mockResolvedValue(false);
    expect(((await streamLoader(args())) as Response).status).toBe(404);
    vi.mocked(slidesLiveEnabled).mockResolvedValue(true);
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "x" });
    expect(((await streamLoader(args())) as Response).status).toBe(404);
    expect(busEventStream).not.toHaveBeenCalled();
  });

  it("401s when signed out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect(((await streamLoader(args())) as Response).status).toBe(401);
  });
});
