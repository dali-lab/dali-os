import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));
vi.mock("../../lib/visibility", () => ({ canViewMentorship: vi.fn() }));
vi.mock("~/collab/legacy/pm-to-blocknote", () => ({
  ensureBlocks: vi.fn((x: unknown) => ({ blocks: x })),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { canViewMentorship } from "../../lib/visibility";
import { action, loader } from "../api.mentorship.templates.$id";

const m = prisma as any;

const get = () =>
  loader({
    request: new Request("http://localhost/api/mentorship/templates/t1"),
    params: { id: "t1" },
  } as any) as Promise<Response>;

const send = (method: string, body?: unknown, raw?: string) =>
  action({
    request: new Request("http://localhost/api/mentorship/templates/t1", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    params: { id: "t1" },
  } as any) as Promise<Response>;

let tx: any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(canViewMentorship).mockResolvedValue(true);
  tx = {
    mentorNoteTemplate: {
      updateMany: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  m.mentorNoteTemplate = {
    findUnique: vi.fn().mockResolvedValue({ id: "t1" }),
    delete: vi.fn().mockResolvedValue({}),
  };
  m.$transaction = vi.fn(async (fn: any) => fn(tx));
});

describe("loader", () => {
  it("passes through the auth failure", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as any);
    expect((await get()).status).toBe(401);
  });

  it("forbids users who cannot view mentorship", async () => {
    vi.mocked(canViewMentorship).mockResolvedValue(false);
    const res = await get();
    expect(res.status).toBe(403);
    expect(canViewMentorship).toHaveBeenCalledWith("ada");
    expect(m.mentorNoteTemplate.findUnique).not.toHaveBeenCalled();
  });

  it("404s for a missing template", async () => {
    m.mentorNoteTemplate.findUnique.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it("returns the template with contentJson normalized to blocks", async () => {
    m.mentorNoteTemplate.findUnique.mockResolvedValue({
      id: "t1",
      name: "Weekly",
      contentJson: "legacy",
      isDefault: true,
    });
    const body = await (await get()).json();
    expect(body).toMatchObject({ id: "t1", name: "Weekly", isDefault: true });
    expect(body.contentJson).toEqual({ blocks: "legacy" });
  });
});

describe("action access", () => {
  it("passes through the auth failure", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as any);
    expect((await send("DELETE")).status).toBe(401);
  });

  it("rejects other methods with 405", async () => {
    expect((await send("POST", {})).status).toBe(405);
  });

  it("only Core may patch or delete; non-Core writes nothing", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await send("PATCH", { name: "x" })).status).toBe(403);
    expect((await send("DELETE")).status).toBe(403);
    expect(m.mentorNoteTemplate.delete).not.toHaveBeenCalled();
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("404s for a missing template", async () => {
    m.mentorNoteTemplate.findUnique.mockResolvedValue(null);
    expect((await send("DELETE")).status).toBe(404);
  });
});

describe("DELETE", () => {
  it("deletes the template", async () => {
    const res = await send("DELETE");
    expect(res.status).toBe(200);
    expect(m.mentorNoteTemplate.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });
});

describe("PATCH", () => {
  it("rejects malformed JSON and invalid field types", async () => {
    expect((await send("PATCH", undefined, "{bad")).status).toBe(400);
    expect((await send("PATCH", { name: 1 })).status).toBe(400);
    expect((await send("PATCH", { isDefault: "yes" })).status).toBe(400);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a blank name", async () => {
    const res = await send("PATCH", { name: "  " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name is required" });
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("updates a trimmed name and stamps lastUpdatedBy without touching other templates", async () => {
    const res = await send("PATCH", { name: " Weekly check-in " });
    expect(res.status).toBe(200);
    expect(tx.mentorNoteTemplate.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { lastUpdatedBy: "ada", name: "Weekly check-in" },
    });
    expect(tx.mentorNoteTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("making a template the default clears the flag on every other template", async () => {
    await send("PATCH", { isDefault: true });
    expect(tx.mentorNoteTemplate.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, NOT: { id: "t1" } },
      data: { isDefault: false },
    });
    expect(tx.mentorNoteTemplate.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { lastUpdatedBy: "ada", isDefault: true },
    });
  });

  it("unsetting the default does not clear other templates", async () => {
    await send("PATCH", { isDefault: false });
    expect(tx.mentorNoteTemplate.updateMany).not.toHaveBeenCalled();
    expect(tx.mentorNoteTemplate.update.mock.calls[0][0].data.isDefault).toBe(false);
  });
});
