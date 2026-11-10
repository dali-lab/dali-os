import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isAdmin: vi.fn(),
  currentTerm: vi.fn(),
  logDomainLeadChange: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  del: vi.fn(),
}));

vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: h.requireAuth,
}));
vi.mock("~/lib/roles", () => ({ isAdmin: h.isAdmin, currentTerm: h.currentTerm }));
vi.mock("~/lib/cors", () => ({ withCors: (_r: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/admin/lib/access-audit.server", () => ({ logDomainLeadChange: h.logDomainLeadChange }));
vi.mock("~/lib/db.server", () => ({
  prisma: { domainLeadAssignment: { findMany: h.findMany, create: h.create, delete: h.del } },
}));

import { action, loader } from "~/admin/routes/api.domains.$domainId.leads";

const params = { domainId: "d1" };
const req = (method: string, body?: unknown) =>
  new Request("http://x/api/domains/d1/leads", {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
const call = (fn: typeof action | typeof loader, request: Request) =>
  fn({ request, params } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  h.requireAuth.mockResolvedValue({ ok: true, user: { sub: "admin-1" } });
  h.isAdmin.mockResolvedValue(true);
  h.currentTerm.mockResolvedValue({ id: "t1" });
});

describe("domain leads: admin gate", () => {
  it("returns the auth failure when signed out", async () => {
    h.requireAuth.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    expect((await call(loader, req("GET"))).status).toBe(401);
    expect((await call(action, req("POST", { userId: "u1" }))).status).toBe(401);
  });

  it("403s non-admins on loader and every action without touching the DB", async () => {
    h.isAdmin.mockResolvedValue(false);
    expect((await call(loader, req("GET"))).status).toBe(403);
    expect((await call(action, req("POST", { userId: "u1" }))).status).toBe(403);
    expect((await call(action, req("DELETE", { assignmentId: "a1" }))).status).toBe(403);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe("loader", () => {
  it("lists the leads for the requested domain only", async () => {
    h.findMany.mockResolvedValue([{ id: "a1" }]);
    const res = await call(loader, req("GET"));
    expect(h.findMany).toHaveBeenCalledWith({
      where: { domainId: "d1" },
      include: { user: true, domain: true, term: true },
    });
    expect(await res.json()).toEqual([{ id: "a1" }]);
  });
});

describe("POST (add a lead)", () => {
  it("creates the assignment for the current term and audits it", async () => {
    h.create.mockResolvedValue({ id: "a1" });
    const res = await call(action, req("POST", { userId: "u1" }));
    expect(res.status).toBe(201);
    expect(h.create).toHaveBeenCalledWith({
      data: { userId: "u1", domainId: "d1", termId: "t1" },
      include: { user: true, domain: true, term: true },
    });
    expect(h.logDomainLeadChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "add",
        actorId: "admin-1",
        targetUserId: "u1",
        domainId: "d1",
        assignmentId: "a1",
        termId: "t1",
      }),
    );
  });

  it("400s a body without a userId and creates nothing", async () => {
    expect((await call(action, req("POST", {}))).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("500s with an explanation when there is no current term", async () => {
    h.currentTerm.mockResolvedValue(null);
    const res = await call(action, req("POST", { userId: "u1" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/No current Term/);
    expect(h.create).not.toHaveBeenCalled();
  });
});

describe("DELETE (remove a lead)", () => {
  it("deletes by assignment id and audits the removed lead's user and term", async () => {
    h.del.mockResolvedValue({ userId: "u9", termId: "t0" });
    const res = await call(action, req("DELETE", { assignmentId: "a1" }));
    expect(h.del).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(h.logDomainLeadChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "remove",
        actorId: "admin-1",
        targetUserId: "u9",
        domainId: "d1",
        assignmentId: "a1",
        termId: "t0",
      }),
    );
    expect(await res.json()).toEqual({ ok: true });
  });

  it("400s a body without an assignmentId", async () => {
    expect((await call(action, req("DELETE", {}))).status).toBe(400);
    expect(h.del).not.toHaveBeenCalled();
  });
});

it("405s other methods", async () => {
  expect((await call(action, req("PUT", {}))).status).toBe(405);
});
