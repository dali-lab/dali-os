import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { rubric: { create: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: () => Response.json({ error: "Forbidden" }, { status: 403 }),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/drive-roots.server", () => ({ editableFolderInRoot: vi.fn(), ensureRoot: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { editableFolderInRoot, ensureRoot } from "~/lib/drive-roots.server";
import { action } from "~/routes/api.rubrics";

const m = prisma as any;

const call = async (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const res: Response = await action({
    request: new Request("http://localhost/api/rubrics", { method: "POST", body }),
  } as never);
  return { status: res.status, json: await res.json() };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(editableFolderInRoot).mockResolvedValue(null);
  vi.mocked(ensureRoot).mockResolvedValue("hiring-root");
  m.rubric.create.mockResolvedValue({ id: "r1" });
});

describe("POST /api/rubrics", () => {
  it("creates a rubric in the requested Hiring folder and audits it", async () => {
    vi.mocked(editableFolderInRoot).mockResolvedValue("sub");
    expect(await call({ name: "  Design ", folderPageId: "sub" })).toEqual({ status: 200, json: { ok: true, rubricId: "r1" } });
    expect(editableFolderInRoot).toHaveBeenCalledWith("u1", "sub", "hiring", expect.any(Request));
    expect(m.rubric.create).toHaveBeenCalledWith({ data: { name: "Design", folderPageId: "sub" }, select: { id: true } });
    expect(ensureRoot).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "rubric.create", userId: "u1", targetId: "r1", metadata: { folderPageId: "sub" } }),
    );
  });

  it("files into the Hiring root when no folder is given or it isn't usable", async () => {
    await call({ name: "Design" });
    expect(editableFolderInRoot).toHaveBeenCalledWith("u1", null, "hiring", expect.any(Request));
    await call({ name: "Design", folderPageId: "elsewhere" });
    expect(ensureRoot).toHaveBeenCalledWith("hiring", "u1");
    expect(m.rubric.create).toHaveBeenLastCalledWith({ data: { name: "Design", folderPageId: "hiring-root" }, select: { id: true } });
  });

  it("403s anyone but Core before reading the body", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await call({ name: "Design" })).status).toBe(403);
    expect(m.rubric.create).not.toHaveBeenCalled();
  });

  it("refuses a blank name", async () => {
    expect(await call({ name: "   " })).toEqual({ status: 400, json: { error: "Enter a name" } });
    expect(m.rubric.create).not.toHaveBeenCalled();
  });

  it("passes through an auth failure", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("{}", { status: 401 }) } as never);
    expect((await call({ name: "Design" })).status).toBe(401);
    expect(isCore).not.toHaveBeenCalled();
  });
});
