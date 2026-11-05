import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    docTag: { findUnique: vi.fn() },
    page: { findUnique: vi.fn() },
    pageTag: { upsert: vi.fn(), deleteMany: vi.fn() },
    projectFile: { findUnique: vi.fn() },
    projectFileTag: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
}));
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_r: Request, res: Response) => res,
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { action } from "../api.doctags.apply";

const m = prisma as any;

function run(body: unknown, method = "POST") {
  return action({
    request: new Request("http://localhost/api/doctags/apply", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}
const doc = (op: "add" | "remove" = "add") => ({ targetType: "doc", targetId: "p1", tagId: "t1", op });
const file = (op: "add" | "remove" = "add") => ({ targetType: "file", targetId: "f1", tagId: "t1", op });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  m.docTag.findUnique.mockResolvedValue({ id: "t1" });
  m.page.findUnique.mockResolvedValue({ workspaceType: "Project", archivedAt: null });
  m.projectFile.findUnique.mockResolvedValue({ archivedAt: null });
});

describe("POST /api/doctags/apply — gate and validation", () => {
  it("requires authentication", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect((await run(doc())).status).toBe(401);
  });

  it("rejects non-POST with 405", async () => {
    expect((await run(null, "GET")).status).toBe(405);
  });

  it("is Core only and writes nothing otherwise", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await run(doc())).status).toBe(403);
    expect(m.pageTag.upsert).not.toHaveBeenCalled();
    expect(m.projectFileTag.upsert).not.toHaveBeenCalled();
  });

  it.each([
    { ...doc(), targetType: "page" },
    { ...doc(), op: "toggle" },
    { ...doc(), tagId: "" },
    { targetType: "doc", op: "add" },
  ])("400s an invalid body %j", async (body) => {
    expect((await run(body)).status).toBe(400);
  });

  it("404s an unknown tag", async () => {
    m.docTag.findUnique.mockResolvedValue(null);
    const res = await run(doc());
    expect(res.status).toBe(404);
    expect(m.pageTag.upsert).not.toHaveBeenCalled();
  });
});

describe("POST /api/doctags/apply — documents", () => {
  it("adds the tag idempotently", async () => {
    expect(await (await run(doc("add"))).json()).toEqual({ ok: true });
    expect(m.pageTag.upsert).toHaveBeenCalledWith({
      where: { pageId_tagId: { pageId: "p1", tagId: "t1" } },
      create: { pageId: "p1", tagId: "t1" },
      update: {},
    });
  });

  it("removes the tag", async () => {
    await run(doc("remove"));
    expect(m.pageTag.deleteMany).toHaveBeenCalledWith({ where: { pageId: "p1", tagId: "t1" } });
    expect(m.pageTag.upsert).not.toHaveBeenCalled();
  });

  it("accepts Lab documents too", async () => {
    m.page.findUnique.mockResolvedValue({ workspaceType: "Lab", archivedAt: null });
    expect((await run(doc())).status).toBe(200);
  });

  it.each([
    ["a missing page", null],
    ["a Member note", { workspaceType: "Member", archivedAt: null }],
    ["an education page", { workspaceType: "EducationOffering", archivedAt: null }],
    ["an archived page", { workspaceType: "Project", archivedAt: new Date() }],
  ])("404s %s and tags nothing", async (_n, page) => {
    m.page.findUnique.mockResolvedValue(page);
    const res = await run(doc());
    expect(res.status).toBe(404);
    expect(m.pageTag.upsert).not.toHaveBeenCalled();
    expect(m.pageTag.deleteMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/doctags/apply — files", () => {
  it("adds and removes a tag on a file", async () => {
    await run(file("add"));
    expect(m.projectFileTag.upsert).toHaveBeenCalledWith({
      where: { fileId_tagId: { fileId: "f1", tagId: "t1" } },
      create: { fileId: "f1", tagId: "t1" },
      update: {},
    });
    await run(file("remove"));
    expect(m.projectFileTag.deleteMany).toHaveBeenCalledWith({ where: { fileId: "f1", tagId: "t1" } });
  });

  it("404s a missing or archived file", async () => {
    m.projectFile.findUnique.mockResolvedValue(null);
    expect((await run(file())).status).toBe(404);
    m.projectFile.findUnique.mockResolvedValue({ archivedAt: new Date() });
    expect((await run(file())).status).toBe(404);
    expect(m.projectFileTag.upsert).not.toHaveBeenCalled();
  });
});
