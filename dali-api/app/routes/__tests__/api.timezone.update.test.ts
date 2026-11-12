import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { user: { update: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), unauthorized: vi.fn(() => new Response(null, { status: 401 })) }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { action } from "../api.timezone.update";

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/api/timezone/update", { method: "POST", body }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
});

describe("api.timezone.update", () => {
  it("saves a valid zone by default", async () => {
    const res = await post({ timeZone: " America/Chicago " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { timeZone: "America/Chicago" } });
  });

  it("rejects an unknown zone with the exact message and saves nothing", async () => {
    const cases: Record<string, string>[] = [{ timeZone: "Mars/Base" }, { timeZone: "" }, {}];
    for (const fields of cases) {
      const res = await post(fields);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Unrecognized timezone." });
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("dismiss sets the cookie and does not save", async () => {
    const res = await post({ intent: "dismiss", timeZone: "America/Chicago" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeTruthy();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects a bad zone on dismiss too", async () => {
    expect((await post({ intent: "dismiss", timeZone: "nope" })).status).toBe(400);
  });
});
