import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/sse.server", () => ({ busEventStream: vi.fn(() => new Response("stream")) }));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: vi.fn() }));
vi.mock("~/lib/slide-live.server", () => ({ slidesLiveEnabled: vi.fn() }));
vi.mock("~/lib/slide-poll.server", async () => {
  const { z } = await import("zod");
  return {
    slidePollTopic: (id: string) => `slide-poll:${id}`,
    slideReactTopic: (id: string) => `slide-react:${id}`,
    readPolls: vi.fn(),
    applyPoll: vi.fn(),
    sendReaction: vi.fn(),
    pollIntentSchema: z.discriminatedUnion("intent", [
      z.object({ intent: z.literal("vote"), pollId: z.string().min(1), choices: z.array(z.number().int()) }),
      z.object({ intent: z.literal("close"), pollId: z.string().min(1) }),
    ]),
    reactionSchema: z.object({ emoji: z.string().min(1) }),
  };
});

import { requireAuth } from "~/lib/auth";
import { busEventStream } from "~/lib/sse.server";
import { deckAccess } from "~/lib/slide-decks.server";
import { slidesLiveEnabled } from "~/lib/slide-live.server";
import { applyPoll, readPolls, sendReaction } from "~/lib/slide-poll.server";
import { action as pollAction, loader as pollLoader } from "../api.slides.$pageId.polls";
import { loader as pollStream } from "../api.slides.$pageId.polls.stream";
import { action as reactAction } from "../api.slides.$pageId.reactions";
import { loader as reactStream } from "../api.slides.$pageId.reactions.stream";

const state = { active: true, polls: {} };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(slidesLiveEnabled).mockResolvedValue(true);
  vi.mocked(deckAccess).mockResolvedValue({ ok: true } as never);
  vi.mocked(busEventStream).mockReturnValue(new Response("stream"));
});

const args = (init?: RequestInit) => ({ request: new Request("http://t/api/slides/p1/polls", init), params: { pageId: "p1" } }) as never;
const post = (body: unknown) => args({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("GET /api/slides/:pageId/polls", () => {
  it("returns the poll state without caching", async () => {
    vi.mocked(readPolls).mockResolvedValue({ ok: true, state });
    const res = (await pollLoader(args())) as Response;
    expect(await res.json()).toEqual(state);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(readPolls).toHaveBeenCalledWith("u1", "p1", expect.any(Request));
  });

  it("404s when slides-live is off for the user", async () => {
    vi.mocked(slidesLiveEnabled).mockResolvedValue(false);
    expect(((await pollLoader(args())) as Response).status).toBe(404);
    expect(readPolls).not.toHaveBeenCalled();
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect(((await pollLoader(args())) as Response).status).toBe(401);
  });

  it("surfaces an access failure", async () => {
    vi.mocked(readPolls).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(((await pollLoader(args())) as Response).status).toBe(404);
  });
});

describe("POST /api/slides/:pageId/polls", () => {
  it("applies a valid vote", async () => {
    vi.mocked(applyPoll).mockResolvedValue({ ok: true, state });
    const res = (await pollAction(post({ intent: "vote", pollId: "e1", choices: [0] }))) as Response;
    expect(res.status).toBe(200);
    expect(applyPoll).toHaveBeenCalledWith("u1", "p1", { intent: "vote", pollId: "e1", choices: [0] }, expect.any(Request));
  });

  it("rejects a body that is not an intent", async () => {
    const res = (await pollAction(post({ intent: "explode" }))) as Response;
    expect(res.status).toBe(400);
    expect(applyPoll).not.toHaveBeenCalled();
  });

  it("returns the lib's refusal status and message", async () => {
    vi.mocked(applyPoll).mockResolvedValue({ ok: false, status: 409, error: "Voting is closed." });
    const res = (await pollAction(post({ intent: "vote", pollId: "e1", choices: [0] }))) as Response;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Voting is closed." });
  });

  it("only takes POST and respects the flag", async () => {
    expect(((await pollAction(args({ method: "PUT" }))) as Response).status).toBe(405);
    vi.mocked(slidesLiveEnabled).mockResolvedValue(false);
    expect(((await pollAction(post({ intent: "close", pollId: "e1" }))) as Response).status).toBe(404);
  });
});

describe("poll stream", () => {
  it("streams the deck's poll topic to someone who can see the deck", async () => {
    await pollStream(args());
    expect(busEventStream).toHaveBeenCalledWith(expect.any(Request), ["slide-poll:p1"], { syncMs: 30_000 });
  });

  it("refuses without access, flag or sign-in", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "x" });
    expect(((await pollStream(args())) as Response).status).toBe(404);
    vi.mocked(deckAccess).mockResolvedValue({ ok: true } as never);
    vi.mocked(slidesLiveEnabled).mockResolvedValue(false);
    expect(((await pollStream(args())) as Response).status).toBe(404);
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect(((await pollStream(args())) as Response).status).toBe(401);
    expect(busEventStream).not.toHaveBeenCalled();
  });
});

describe("POST /api/slides/:pageId/reactions", () => {
  it("sends a reaction", async () => {
    vi.mocked(sendReaction).mockResolvedValue({ ok: true });
    const res = (await reactAction(post({ emoji: "👍" }))) as Response;
    expect(await res.json()).toEqual({ ok: true });
    expect(sendReaction).toHaveBeenCalledWith("u1", "p1", "👍", expect.any(Request));
  });

  it("returns the rate limit as 429", async () => {
    vi.mocked(sendReaction).mockResolvedValue({ ok: false, status: 429, error: "Slow down a little." });
    expect(((await reactAction(post({ emoji: "👍" }))) as Response).status).toBe(429);
  });

  it("rejects an empty body, a wrong method and the flag being off", async () => {
    expect(((await reactAction(post({}))) as Response).status).toBe(400);
    expect(((await reactAction(args({ method: "GET" }))) as Response).status).toBe(405);
    vi.mocked(slidesLiveEnabled).mockResolvedValue(false);
    expect(((await reactAction(post({ emoji: "👍" }))) as Response).status).toBe(404);
    expect(sendReaction).not.toHaveBeenCalled();
  });
});

describe("reaction stream", () => {
  it("carries the publisher's payload on the reaction topic", async () => {
    await reactStream(args());
    expect(busEventStream).toHaveBeenCalledWith(expect.any(Request), ["slide-react:p1"], { carryData: true });
  });

  it("refuses without access", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "x" });
    expect(((await reactStream(args())) as Response).status).toBe(404);
    expect(busEventStream).not.toHaveBeenCalled();
  });
});
