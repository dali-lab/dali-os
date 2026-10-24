import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/lib/db", () => ({ prisma: {
  partnerApplicationTargetTerm: { update: vi.fn() },
  partnerApplicationDomain: { update: vi.fn() },
} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: () => new Response(null, { status: 403 }) }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_: Request, res: Response) => res, handlePreflight: () => null }));
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { Prisma } from "~/generated/prisma/client";
import { action as plan } from "../api.partner-application-target-terms.$id";
import { action as domain } from "../api.partner-application-domains.$id";

function call(action: typeof plan | typeof domain, body: unknown, method = "POST", raw?: string) {
  return action({ request: new Request("http://localhost/api/test/id", {
    method, headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body),
  }), params: { id: "id" }, context: {} } as never);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
});
it.each([plan, domain])("requires authentication and Core access", async (action) => {
  vi.mocked(requireAuth).mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 401 }) } as never);
  expect((await call(action, {})).status).toBe(401);
  vi.mocked(isCore).mockResolvedValueOnce(false);
  expect((await call(action, {})).status).toBe(403);
  expect(prisma.partnerApplicationTargetTerm.update).not.toHaveBeenCalled();
  expect(prisma.partnerApplicationDomain.update).not.toHaveBeenCalled();
});
it.each(["Continuing", "Later", "Maybe", "New", null])("patches only status: %s", async (planningStatus) => {
  expect((await call(plan, { planningStatus })).status).toBe(200);
  expect(prisma.partnerApplicationTargetTerm.update).toHaveBeenCalledWith({ where: { id: "id" }, data: { planningStatus } });
});
it("patches notes without changing the status or todo, and permits clearing", async () => {
  await call(plan, { plannerNotes: "Budget confirmed" });
  expect(prisma.partnerApplicationTargetTerm.update).toHaveBeenLastCalledWith({ where: { id: "id" }, data: { plannerNotes: "Budget confirmed" } });
  await call(plan, { plannerNotes: "", plannerTodo: null });
  expect(prisma.partnerApplicationTargetTerm.update).toHaveBeenLastCalledWith({ where: { id: "id" }, data: { plannerNotes: null, plannerTodo: null } });
});
it.each([[], null, { planningStatus: "Invalid" }, { plannerNotes: 3 }, { plannerTodo: false }])("rejects invalid planning bodies: %j", async (body) => {
  expect((await call(plan, body)).status).toBe(400);
  expect(prisma.partnerApplicationTargetTerm.update).not.toHaveBeenCalled();
});
it.each([plan, domain])("rejects invalid JSON and unsupported methods", async (action) => {
  expect((await call(action, null, "POST", "{")).status).toBe(400);
  expect((await call(action, {}, "PATCH")).status).toBe(405);
});
it("returns 404 when the target term is gone", async () => {
  vi.mocked(prisma.partnerApplicationTargetTerm.update).mockRejectedValueOnce({ code: "P2025" });
  expect((await call(plan, { plannerTodo: "Follow up" })).status).toBe(404);
});
it("headcount-only writes leave the BlockNote scope untouched", async () => {
  expect((await call(domain, { expectedMembers: 3 })).status).toBe(200);
  expect(prisma.partnerApplicationDomain.update).toHaveBeenCalledWith({ where: { id: "id" }, data: { expectedMembers: 3 } });
});
it("still supports explicit scope updates and clearing", async () => {
  const blocks = [{ id: "b", type: "paragraph", content: [{ type: "text", text: "Scope" }] }];
  await call(domain, { expectedMembers: 2, expectedChallenges: blocks });
  expect(prisma.partnerApplicationDomain.update).toHaveBeenLastCalledWith({ where: { id: "id" }, data: { expectedMembers: 2, expectedChallenges: blocks } });
  await call(domain, { expectedMembers: 0, expectedChallenges: null });
  expect(prisma.partnerApplicationDomain.update).toHaveBeenLastCalledWith({ where: { id: "id" }, data: { expectedMembers: 0, expectedChallenges: Prisma.JsonNull } });
});
it("rejects overflowing and nonfinite headcounts before the database", async () => {
  expect((await call(domain, { expectedMembers: 2147483648 })).status).toBe(400);
  expect((await call(domain, null, "POST", '{"expectedMembers":1e400}')).status).toBe(400);
  expect(prisma.partnerApplicationDomain.update).not.toHaveBeenCalled();
});
