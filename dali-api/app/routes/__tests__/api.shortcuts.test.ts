import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/shortcuts.server", () => {
  class ShortcutError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  }
  return {
    ShortcutError,
    createShortcut: vi.fn(),
    deleteShortcut: vi.fn(),
    placePage: vi.fn(),
    swapPrimary: vi.fn(),
    placementsOf: vi.fn(),
  };
});

import { requireAuth } from "~/lib/auth";
import { createShortcut, deleteShortcut, placePage, swapPrimary, placementsOf, ShortcutError } from "~/lib/shortcuts.server";
import { action as createAction } from "../api.shortcuts";
import { action as deleteAction } from "../api.shortcuts.$id";
import { action as placeAction } from "../api.pages.$id.place";
import { action as swapAction } from "../api.pages.$id.swap-primary";
import { loader as shortcutsLoader } from "../api.pages.$id.shortcuts";

const dest = { workspaceType: "Project", workspaceId: "projA", parentPageId: "f1" };

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
});

describe("POST /api/shortcuts", () => {
  const call = (body: unknown, method = "POST") => createAction({ request: req(method, body), params: {} } as any);

  it("creates a shortcut as the signed-in user and returns what the service reports", async () => {
    vi.mocked(createShortcut).mockResolvedValue({
      shortcutId: "s1",
      created: true,
      grantShareId: null,
      grantDeclined: true,
    });

    const res = await call({ targetPageId: "t1", dest });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, shortcutId: "s1", created: true, grantShareId: null, grantDeclined: true });
    expect(createShortcut).toHaveBeenCalledWith(expect.objectContaining({ targetPageId: "t1", dest, actorId: "u1" }));
  });

  it("is 401 without a session and touches nothing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) } as any);
    const res = await call({ targetPageId: "t1", dest });
    expect(res.status).toBe(401);
    expect(createShortcut).not.toHaveBeenCalled();
  });

  it("is 405 for other methods", async () => {
    expect((await call(undefined, "GET")).status).toBe(405);
  });

  it("is 400 for a body that isn't a target and a lab, project or offering destination", async () => {
    expect((await call({ dest })).status).toBe(400);
    expect((await call({ targetPageId: "t1", dest: { ...dest, workspaceType: "Member" } })).status).toBe(400);
    expect(createShortcut).not.toHaveBeenCalled();
  });

  it("maps a service refusal to its status and message", async () => {
    vi.mocked(createShortcut).mockRejectedValue(new ShortcutError("You can't put things in that folder", 403));
    const res = await call({ targetPageId: "t1", dest });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "You can't put things in that folder" });
  });

  it("lets an unexpected failure through as a server error", async () => {
    vi.mocked(createShortcut).mockRejectedValue(new Error("db down"));
    await expect(call({ targetPageId: "t1", dest })).rejects.toThrow("db down");
  });
});

describe("DELETE /api/shortcuts/:id", () => {
  const call = (method = "DELETE") => deleteAction({ request: req(method), params: { id: "s1" } } as any);

  it("deletes as the signed-in user", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteShortcut).toHaveBeenCalledWith("s1", "u1", expect.any(Request));
  });

  it("is 401 without a session and 405 for POST", async () => {
    expect((await call("POST")).status).toBe(405);
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) } as any);
    expect((await call()).status).toBe(401);
    expect(deleteShortcut).not.toHaveBeenCalled();
  });

  it("maps a refusal to its status", async () => {
    vi.mocked(deleteShortcut).mockRejectedValue(new ShortcutError("Shortcut not found", 404));
    expect((await call()).status).toBe(404);
  });
});

describe("POST /api/pages/:id/place", () => {
  const call = (body: unknown) => placeAction({ request: req("POST", body), params: { id: "p1" } } as any);

  it("places the page and reports the shortcuts and declined grants", async () => {
    vi.mocked(placePage).mockResolvedValue({ primaryId: "p1", shortcutIds: ["s1"], declined: 1 });

    const res = await call({ destinations: [dest, { ...dest, parentPageId: "f2" }], primaryIndex: 1 });

    expect(await res.json()).toEqual({ ok: true, primaryId: "p1", shortcutIds: ["s1"], declined: 1 });
    expect(placePage).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: "p1", primaryIndex: 1, actorId: "u1", destinations: [dest, { ...dest, parentPageId: "f2" }] }),
    );
  });

  it("is 400 for no destinations or a negative primary", async () => {
    expect((await call({ destinations: [], primaryIndex: 0 })).status).toBe(400);
    expect((await call({ destinations: [dest], primaryIndex: -1 })).status).toBe(400);
    expect(placePage).not.toHaveBeenCalled();
  });

  it("is 401 without a session", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) } as any);
    expect((await call({ destinations: [dest], primaryIndex: 0 })).status).toBe(401);
  });

  it("maps a move refusal to its status", async () => {
    vi.mocked(placePage).mockRejectedValue(new ShortcutError("You can't move this document", 403));
    expect((await call({ destinations: [dest], primaryIndex: 0 })).status).toBe(403);
  });
});

describe("POST /api/pages/:id/swap-primary", () => {
  const call = (body: unknown) => swapAction({ request: req("POST", body), params: { id: "p1" } } as any);

  it("swaps as the signed-in user", async () => {
    vi.mocked(swapPrimary).mockResolvedValue({ primaryId: "p1", shortcutId: "s9" });

    const res = await call({ shortcutId: "s1" });

    expect(await res.json()).toEqual({ ok: true, primaryId: "p1", shortcutId: "s9" });
    expect(swapPrimary).toHaveBeenCalledWith("p1", "s1", "u1", expect.any(Request));
  });

  it("is 400 without a shortcut id and 401 without a session", async () => {
    expect((await call({})).status).toBe(400);
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) } as any);
    expect((await call({ shortcutId: "s1" })).status).toBe(401);
    expect(swapPrimary).not.toHaveBeenCalled();
  });

  it("maps a refusal to its status", async () => {
    vi.mocked(swapPrimary).mockRejectedValue(new ShortcutError("Shortcut not found", 404));
    expect((await call({ shortcutId: "s1" })).status).toBe(404);
  });
});

describe("GET /api/pages/:id/shortcuts", () => {
  const call = (method = "GET") => shortcutsLoader({ request: req(method), params: { id: "p1" } } as any);
  const placements = {
    primary: { workspaceType: "Project", workspaceId: "projA", folderId: "f1", path: [{ id: "f1", title: "Meetings" }] },
    shortcuts: [{ shortcutId: "s1", workspaceType: "Lab", workspaceId: null, folderId: null, path: [] }],
  };

  it("returns where the page lives and its shortcuts, for the signed-in viewer", async () => {
    vi.mocked(placementsOf).mockResolvedValue(placements as any);
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...placements });
    expect(placementsOf).toHaveBeenCalledWith("p1", "u1", expect.any(Request));
  });

  it("is 401 without a session and reads nothing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: Response.json({}, { status: 401 }) } as any);
    expect((await call()).status).toBe(401);
    expect(placementsOf).not.toHaveBeenCalled();
  });

  it("is 404 for a page the viewer can't see", async () => {
    vi.mocked(placementsOf).mockRejectedValue(new ShortcutError("Document not found", 404));
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Document not found" });
  });
});
