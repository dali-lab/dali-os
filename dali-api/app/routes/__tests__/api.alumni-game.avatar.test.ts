import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));

import { mockedPrisma } from "~/test-utils/prisma";
import { requireMemberSession } from "~/lib/auth";
import { action } from "../api.alumni-game.avatar";

const db = mockedPrisma();

const post = (body: unknown, method = "POST") =>
  action({
    request: new Request("https://os.example/api/alumni-game/avatar", {
      method,
      body: method === "POST" ? JSON.stringify(body) : undefined,
      headers: { "Content-Type": "application/json" },
    }),
  } as never) as Promise<Response>;

const config = { skinTone: "tan", eyeColor: "green", hairColor: "blonde", hairstyle: "wavy" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({
    ok: true,
    auth: { user: { sub: "u1" } },
  } as never);
  db.pixelAvatar.upsert.mockResolvedValue({} as never);
});

describe("POST /api/alumni-game/avatar", () => {
  it("rejects a caller without a member session", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    const res = await post(config);
    expect(res.status).toBe(403);
    expect(db.pixelAvatar.upsert).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    const res = await post(undefined, "GET");
    expect(res.status).toBe(405);
  });

  it("rejects an avatar outside the catalogs", async () => {
    for (const bad of [
      null,
      {},
      { ...config, hairstyle: "mohawk" },
      { ...config, skinTone: "neon" },
      { ...config, eyeColor: "laser" },
      { ...config, hairColor: "rainbow" },
    ]) {
      const res = await post(bad);
      expect(res.status).toBe(400);
    }
    expect(db.pixelAvatar.upsert).not.toHaveBeenCalled();
  });

  it("upserts exactly the catalog fields for the signed-in user", async () => {
    const res = await post({ ...config, userId: "someone-else", extra: "ignored" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(db.pixelAvatar.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" },
      create: { userId: "u1", ...config },
      update: config,
    });
  });
});
