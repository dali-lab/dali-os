import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { docTag: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
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
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { loader, action } from "../api.doctags";

const m = prisma as any;
const SELECT = { id: true, label: true, slug: true, color: true };

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://localhost/api/doctags", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  m.docTag.findUnique.mockResolvedValue(null);
});

describe("GET /api/doctags", () => {
  const run = () => loader({ request: new Request("http://localhost/api/doctags"), params: {}, context: {} } as never) as Promise<Response>;

  it("requires authentication", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect((await run()).status).toBe(401);
    expect(m.docTag.findMany).not.toHaveBeenCalled();
  });

  it("lists active tags alphabetically for any signed-in user, without Core", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    m.docTag.findMany.mockResolvedValue([{ id: "t1", label: "Design", slug: "design", color: null }]);
    expect(await (await run()).json()).toEqual([{ id: "t1", label: "Design", slug: "design", color: null }]);
    expect(m.docTag.findMany).toHaveBeenCalledWith({
      where: { archivedAt: null },
      orderBy: { label: "asc" },
      select: SELECT,
    });
  });
});

describe("POST /api/doctags", () => {
  it("requires authentication", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect((await post({ label: "UI" })).status).toBe(401);
  });

  it("is Core only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await post({ label: "UI" })).status).toBe(403);
    expect(m.docTag.create).not.toHaveBeenCalled();
  });

  it("rejects other methods with 405", async () => {
    expect((await post(null, "GET")).status).toBe(405);
  });

  it.each([{ label: "" }, { label: "   " }, { label: "x".repeat(41) }, {}])("rejects an invalid body %j", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(m.docTag.create).not.toHaveBeenCalled();
  });

  it("creates a tag with a slug derived from the label, and audits it", async () => {
    m.docTag.create.mockResolvedValue({ id: "t1", label: "UI/UX", slug: "ui-ux", color: "teal" });
    const res = await post({ label: "  UI/UX  ", color: "teal" });
    expect(res.status).toBe(201);
    expect(m.docTag.create).toHaveBeenCalledWith({
      data: { label: "UI/UX", slug: "ui-ux", color: "teal" },
      select: SELECT,
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "doctag.create", userId: "u1", targetId: "t1", metadata: { label: "UI/UX", slug: "ui-ux" } }),
    );
  });

  it("stores a null colour when none is given and falls back to 'tag' for a symbol-only label", async () => {
    m.docTag.create.mockResolvedValue({ id: "t2" });
    await post({ label: "!!!" });
    expect(m.docTag.create).toHaveBeenCalledWith({
      data: { label: "!!!", slug: "tag", color: null },
      select: SELECT,
    });
  });

  it("409s a duplicate of an active tag", async () => {
    m.docTag.findUnique.mockResolvedValue({ id: "t1", archivedAt: null });
    const res = await post({ label: "Design" });
    expect(res.status).toBe(409);
    expect(m.docTag.create).not.toHaveBeenCalled();
  });

  it("revives an archived tag with the same slug, keeping its colour unless a new one is given", async () => {
    m.docTag.findUnique.mockResolvedValue({ id: "t1", archivedAt: new Date(), color: "red" });
    m.docTag.update.mockResolvedValue({ id: "t1" });
    const res = await post({ label: "Design" });
    expect(res.status).toBe(200);
    expect(m.docTag.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { archivedAt: null, label: "Design", color: "red" },
      select: SELECT,
    });
    expect(m.docTag.create).not.toHaveBeenCalled();
  });
});
