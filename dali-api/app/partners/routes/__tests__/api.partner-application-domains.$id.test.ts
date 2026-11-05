import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { partnerApplicationDomain: { update: vi.fn(), delete: vi.fn() } },
  Prisma: { JsonNull: Symbol.for("Prisma.JsonNull") },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: () => null,
}));

import { prisma, Prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { action } from "~/partners/routes/api.partner-application-domains.$id";

const row = prisma.partnerApplicationDomain as unknown as Record<string, ReturnType<typeof vi.fn>>;

function call(method: string, body?: unknown, raw?: string) {
  const request = new Request("http://localhost/api/partner-application-domains/row-1", {
    method,
    headers: { "content-type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return action({ request, params: { id: "row-1" }, context: {} } as any) as Promise<Response>;
}

const blocks = [{ type: "paragraph", content: [{ type: "text", text: "Scope" }] }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core-1" } } as any);
  vi.mocked(isCore).mockResolvedValue(true);
  row.update.mockResolvedValue({});
  row.delete.mockResolvedValue({});
});

describe("partner application domain — access", () => {
  it("returns the auth failure response when unauthenticated", async () => {
    const denied = new Response("no", { status: 401 });
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await call("DELETE")).toBe(denied);
    expect(row.delete).not.toHaveBeenCalled();
  });

  it("rejects non-Core callers on both methods without writing", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await call("DELETE")).status).toBe(403);
    expect((await call("POST", { expectedMembers: 2 })).status).toBe(403);
    expect(row.delete).not.toHaveBeenCalled();
    expect(row.update).not.toHaveBeenCalled();
  });

  it("rejects other methods with 405", async () => {
    expect((await call("PUT", { expectedMembers: 2 })).status).toBe(405);
  });
});

describe("partner application domain — DELETE", () => {
  it("hard-deletes the row by id", async () => {
    const res = await call("DELETE");
    expect(res.status).toBe(200);
    expect(row.delete).toHaveBeenCalledWith({ where: { id: "row-1" } });
  });

  it("404s when the row does not exist (Prisma P2025)", async () => {
    row.delete.mockRejectedValue({ code: "P2025" });
    expect((await call("DELETE")).status).toBe(404);
  });

  it("rethrows unexpected database errors", async () => {
    row.delete.mockRejectedValue(new Error("boom"));
    await expect(call("DELETE")).rejects.toThrow("boom");
  });
});

describe("partner application domain — POST validation", () => {
  it("rejects malformed JSON", async () => {
    expect((await call("POST", undefined, "{nope")).status).toBe(400);
  });

  it.each([
    ["missing expectedMembers", {}],
    ["string expectedMembers", { expectedMembers: "3" }],
    ["NaN-like expectedMembers", { expectedMembers: null }],
    ["over the int4 limit", { expectedMembers: 2_147_483_648 }],
    ["non-array expectedChallenges", { expectedMembers: 1, expectedChallenges: "text" }],
  ])("rejects %s", async (_label, body) => {
    expect((await call("POST", body)).status).toBe(400);
    expect(row.update).not.toHaveBeenCalled();
  });
});

describe("partner application domain — POST update", () => {
  it("floors a fractional member count and clamps negatives to zero", async () => {
    await call("POST", { expectedMembers: 2.9 });
    expect(row.update).toHaveBeenLastCalledWith({ where: { id: "row-1" }, data: { expectedMembers: 2 } });
    await call("POST", { expectedMembers: -4 });
    expect(row.update).toHaveBeenLastCalledWith({ where: { id: "row-1" }, data: { expectedMembers: 0 } });
  });

  it("leaves expectedChallenges untouched when the key is omitted", async () => {
    await call("POST", { expectedMembers: 3 });
    expect(row.update.mock.calls[0][0].data).not.toHaveProperty("expectedChallenges");
  });

  it("stores the block array when it has content", async () => {
    await call("POST", { expectedMembers: 3, expectedChallenges: blocks });
    expect(row.update.mock.calls[0][0].data).toEqual({ expectedMembers: 3, expectedChallenges: blocks });
  });

  it.each([[null], [[]]])("clears the scope to JsonNull for empty value %j", async (empty) => {
    await call("POST", { expectedMembers: 3, expectedChallenges: empty });
    expect(row.update.mock.calls[0][0].data.expectedChallenges).toBe(Prisma.JsonNull);
  });

  it("404s when the row does not exist", async () => {
    row.update.mockRejectedValue({ code: "P2025" });
    expect((await call("POST", { expectedMembers: 1 })).status).toBe(404);
  });
});
