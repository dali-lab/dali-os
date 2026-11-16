import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));

import { requireMemberSession } from "~/lib/auth";
import { resetPresence, heartbeat } from "~/lib/alumni-presence.server";
import { SERVER_CAPACITY } from "~/components/alumni-game/servers";
import { DEFAULT_AVATAR } from "~/components/alumni-game/pixel-avatar";
import { action } from "../api.alumni-game.presence";

const post = (body: unknown) =>
  action({
    request: new Request("https://os.example/api/alumni-game/presence", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  } as never) as Promise<Response>;

const beat = { server: "lab-1", avatar: DEFAULT_AVATAR, x: 1280, y: 980 };

beforeEach(() => {
  vi.clearAllMocks();
  resetPresence();
  vi.mocked(requireMemberSession).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "u1", firstName: "Ada" } },
  } as never);
});

describe("POST /api/alumni-game/presence", () => {
  it("rejects a caller without a member session", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    expect((await post(beat)).status).toBe(403);
  });

  it("rejects an unknown server, bad avatar or missing coordinates", async () => {
    for (const bad of [
      { ...beat, server: "lab-99" },
      { ...beat, avatar: { skinTone: "neon" } },
      { ...beat, x: "here" },
      { ...beat, y: Infinity },
      null,
    ]) {
      expect((await post(bad)).status).toBe(400);
    }
  });

  it("returns the other players and per-server counts", async () => {
    heartbeat("lab-1", { userId: "u2", name: "Grace", avatar: DEFAULT_AVATAR, x: 500, y: 700 });
    const res = await post(beat);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.counts["lab-1"]).toBe(2);
    expect(data.players).toEqual([
      { id: "u2", name: "Grace", avatar: DEFAULT_AVATAR, x: 500, y: 700 },
    ]);
  });

  it("answers 409 when the chosen server is full", async () => {
    for (let i = 0; i < SERVER_CAPACITY; i++) {
      heartbeat("lab-1", { userId: `o${i}`, name: "x", avatar: DEFAULT_AVATAR, x: 0, y: 0 });
    }
    const res = await post(beat);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("full");
  });

  it("clamps coordinates into the world", async () => {
    const res = await post({ ...beat, x: 99999, y: -50 });
    expect(res.status).toBe(200);
    const again = await post({ ...beat, server: "lab-1" });
    expect(again.status).toBe(200);
  });

  it("drops the player on leave", async () => {
    await post(beat);
    const res = await post({ intent: "leave" });
    expect((await res.json()).ok).toBe(true);
  });
});
