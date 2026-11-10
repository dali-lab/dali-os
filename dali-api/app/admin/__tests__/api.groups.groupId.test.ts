import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isAdmin: vi.fn(),
  logAuditEvent: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}));

vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: h.requireAuth,
}));
vi.mock("~/lib/roles", () => ({ isAdmin: h.isAdmin }));
vi.mock("~/lib/cors", () => ({ withCors: (_r: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: h.logAuditEvent }));
vi.mock("~/lib/db.server", () => ({
  prisma: { groupDefinition: { findUnique: h.findUnique, update: h.update, delete: h.del } },
}));

import { action } from "~/admin/routes/api.groups.$groupId";

const req = (method: string, body?: unknown) =>
  new Request("http://x/api/groups/g1", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
const call = (request: Request) => action({ request, params: { groupId: "g1" } } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  h.requireAuth.mockResolvedValue({ ok: true, user: { sub: "admin-1" } });
  h.isAdmin.mockResolvedValue(true);
});

describe("admin gate", () => {
  it("returns the auth failure when signed out", async () => {
    h.requireAuth.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    expect((await call(req("DELETE"))).status).toBe(401);
  });

  it("403s non-admins before reading or writing anything", async () => {
    h.isAdmin.mockResolvedValue(false);
    expect((await call(req("DELETE"))).status).toBe(403);
    expect((await call(req("PUT", { name: "x" }))).status).toBe(403);
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("404s an unknown group", async () => {
    h.findUnique.mockResolvedValue(null);
    expect((await call(req("DELETE"))).status).toBe(404);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("refuses to delete a system-managed group", async () => {
    h.findUnique.mockResolvedValue({ systemKey: "all-core" });
    const res = await call(req("DELETE"));
    expect(res.status).toBe(400);
    expect(h.del).not.toHaveBeenCalled();
  });

  it("deletes a custom group, audits it and returns 204", async () => {
    h.findUnique.mockResolvedValue({ systemKey: null });
    const res = await call(req("DELETE"));
    expect(res.status).toBe(204);
    expect(h.del).toHaveBeenCalledWith({ where: { id: "g1" } });
    expect(h.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "group.delete", userId: "admin-1", targetId: "g1" }),
    );
  });
});

describe("PUT / PATCH", () => {
  const staticGroup = { type: "Static", systemKey: null };

  it("404s an unknown group", async () => {
    h.findUnique.mockResolvedValue(null);
    expect((await call(req("PUT", { name: "x" }))).status).toBe(404);
  });

  it("400s an invalid body (blank name, empty member list) before any lookup", async () => {
    expect((await call(req("PUT", { name: "   " }))).status).toBe(400);
    expect((await call(req("PUT", { staticMemberIds: [] }))).status).toBe(400);
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("refuses to edit a system-managed group", async () => {
    h.findUnique.mockResolvedValue({ type: "Static", systemKey: "all-core" });
    expect((await call(req("PATCH", { name: "Renamed" }))).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("refuses to set members on a Dynamic group", async () => {
    h.findUnique.mockResolvedValue({ type: "Dynamic", systemKey: null });
    const res = await call(req("PUT", { staticMemberIds: ["u1"] }));
    expect(res.status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("still lets a Dynamic group be renamed", async () => {
    h.findUnique.mockResolvedValue({ type: "Dynamic", systemKey: null });
    h.update.mockResolvedValue({ id: "g1" });
    expect((await call(req("PATCH", { name: " Leads " }))).status).toBe(200);
    expect(h.update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { name: "Leads" } });
  });

  it("writes only the fields that were sent, and audits what changed", async () => {
    h.findUnique.mockResolvedValue(staticGroup);
    h.update.mockResolvedValue({ id: "g1", name: "Ada's group" });
    const res = await call(req("PUT", { name: "Ada's group", staticMemberIds: ["u1", "u2"] }));
    expect(h.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { name: "Ada's group", staticMemberIds: ["u1", "u2"] },
    });
    expect(h.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "group.update",
        userId: "admin-1",
        targetId: "g1",
        metadata: { renamed: true, membersChanged: true, memberCount: 2 },
      }),
    );
    expect(await res.json()).toEqual({ id: "g1", name: "Ada's group" });
  });

  it("members-only edit leaves the name out of the write", async () => {
    h.findUnique.mockResolvedValue(staticGroup);
    h.update.mockResolvedValue({ id: "g1" });
    await call(req("PATCH", { staticMemberIds: ["u1"] }));
    expect(h.update.mock.calls[0][0].data).toEqual({ staticMemberIds: ["u1"] });
    expect(h.logAuditEvent.mock.calls[0][0].metadata).toEqual({
      renamed: false,
      membersChanged: true,
      memberCount: 1,
    });
  });
});

it("405s other methods", async () => {
  expect((await call(req("POST", {}))).status).toBe(405);
});
