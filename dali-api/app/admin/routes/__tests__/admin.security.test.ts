import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { ipRule: { findMany: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
const rules = vi.hoisted(() => ({
  addIpRule: vi.fn(),
  removeIpRule: vi.fn(),
  findOverlappingTrust: vi.fn(),
}));
vi.mock("~/lib/ip-rules.server", async () => {
  const { normalizeCidr } = await vi.importActual<typeof import("~/lib/ip-rules.server")>(
    "~/lib/ip-rules.server",
  );
  return { ...rules, normalizeCidr };
});

import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { prisma } from "~/lib/db.server";
import { action, loader } from "~/admin/routes/admin.security";

const mockAuth = vi.mocked(requireAuth);
const mockIsAdmin = vi.mocked(isAdmin);
const mockIsCore = vi.mocked(isCore);
const mockAudit = vi.mocked(logAuditEvent);
const mockFindMany = vi.mocked((prisma as any).ipRule.findMany);

function post(fields: Record<string, string>) {
  const request = new Request("http://localhost/admin/security", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return action({ request, params: {}, context: {} } as never) as Promise<any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { sub: "admin-1", type: "member" } } as any);
  mockIsAdmin.mockResolvedValue(true);
  mockIsCore.mockResolvedValue(true);
  rules.findOverlappingTrust.mockResolvedValue(null);
  rules.addIpRule.mockResolvedValue({ id: "r1", cidr: "x" });
});

describe("admin.security action", () => {
  it("rejects a Core member who is not an admin", async () => {
    mockIsAdmin.mockResolvedValue(false);
    const res = (await post({ intent: "add", kind: "block", cidr: "1.2.3.4" })) as Response;
    expect(res.status).toBe(403);
    expect(rules.addIpRule).not.toHaveBeenCalled();
  });

  it("rejects a signed-out request", async () => {
    mockAuth.mockResolvedValue({ ok: false } as any);
    const res = (await post({ intent: "add", kind: "block", cidr: "1.2.3.4" })) as Response;
    expect(res.status).toBe(401);
  });

  it("blocks an outside address with the chosen duration and audits it", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const result = await post({
      intent: "add",
      kind: "block",
      cidr: "165.245.246.69",
      reason: " Scripted sign-in ",
      duration: "7d",
    });
    expect(result).toEqual({ ok: true });
    const expiresAt = new Date(now + 7 * 24 * 60 * 60_000);
    expect(rules.addIpRule).toHaveBeenCalledWith({
      kind: "block",
      cidr: "165.245.246.69/32",
      reason: "Scripted sign-in",
      expiresAt,
      createdByUserId: "admin-1",
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.ip.block",
        userId: "admin-1",
        metadata: { cidr: "165.245.246.69/32", reason: "Scripted sign-in", expiresAt: expiresAt.toISOString() },
      }),
    );
    vi.restoreAllMocks();
  });

  it("makes a block permanent when asked", async () => {
    await post({ intent: "add", kind: "block", cidr: "1.2.3.4", duration: "permanent" });
    expect(rules.addIpRule).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: null }));
  });

  it("asks for confirmation before blocking inside a trusted network", async () => {
    rules.findOverlappingTrust.mockResolvedValue("129.170.0.0/16");
    const result = await post({ intent: "add", kind: "block", cidr: "129.170.212.19", duration: "24h" });
    expect(result).toEqual({ needsConfirm: "129.170.0.0/16" });
    expect(rules.addIpRule).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("blocks inside a trusted network once confirmed", async () => {
    rules.findOverlappingTrust.mockResolvedValue("129.170.0.0/16");
    const result = await post({
      intent: "add",
      kind: "block",
      cidr: "129.170.212.19",
      duration: "24h",
      confirmTrusted: "1",
    });
    expect(result).toEqual({ ok: true });
    expect(rules.findOverlappingTrust).not.toHaveBeenCalled();
    expect(rules.addIpRule).toHaveBeenCalled();
  });

  it("adds a trusted range with no expiry and no overlap check", async () => {
    const result = await post({ intent: "add", kind: "trust", cidr: "10.8.0.0/16", reason: "Lab VPN" });
    expect(result).toEqual({ ok: true });
    expect(rules.findOverlappingTrust).not.toHaveBeenCalled();
    expect(rules.addIpRule).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "trust", cidr: "10.8.0.0/16", reason: "Lab VPN", expiresAt: null }),
    );
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "security.ip.trust" }));
  });

  it.each([
    [{ intent: "add", kind: "block", cidr: "nope" }, /IP address/],
    [{ intent: "add", kind: "allow", cidr: "1.2.3.4" }, /Unknown rule type/],
    [{ intent: "add", kind: "block", cidr: "1.2.3.4", duration: "forever" }, /Unknown duration/],
    [{ intent: "dance" }, /Invalid intent/],
  ])("rejects bad input %o", async (fields, message) => {
    const result = await post(fields as Record<string, string>);
    expect(result.error).toMatch(message);
    expect(rules.addIpRule).not.toHaveBeenCalled();
  });

  it("removes a rule and audits what it was", async () => {
    rules.removeIpRule.mockResolvedValue({ kind: "block", cidr: "1.2.3.4/32" });
    expect(await post({ intent: "remove", id: "r1" })).toEqual({ ok: true });
    expect(rules.removeIpRule).toHaveBeenCalledWith("r1");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.ip.remove",
        metadata: { kind: "block", cidr: "1.2.3.4/32" },
      }),
    );
  });

  it("reports a rule that is already gone", async () => {
    rules.removeIpRule.mockResolvedValue(null);
    expect(await post({ intent: "remove", id: "r1" })).toEqual({ error: "That rule no longer exists." });
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("admin.security loader", () => {
  function load() {
    return loader({ request: new Request("http://localhost/admin/security"), params: {}, context: {} } as never) as Promise<any>;
  }

  it("lists active rules split by kind, read-only for non-admin Core", async () => {
    mockIsAdmin.mockResolvedValue(false);
    const createdAt = new Date("2026-10-23T00:00:00Z");
    mockFindMany.mockResolvedValue([
      { id: "a", kind: "block", cidr: "1.2.3.4/32", reason: null, source: "auto", expiresAt: createdAt, createdAt },
      { id: "b", kind: "trust", cidr: "129.170.0.0/16", reason: "Campus", source: "manual", expiresAt: null, createdAt },
    ]);
    const data = await load();
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] } }),
    );
    expect(data.canEdit).toBe(false);
    expect(data.blocked.map((r: any) => r.id)).toEqual(["a"]);
    expect(data.trusted.map((r: any) => r.id)).toEqual(["b"]);
    expect(data.blocked[0].expiresAt).toBe(createdAt.toISOString());
  });

  it("sends a non-Core member away", async () => {
    mockIsCore.mockResolvedValue(false);
    const res = (await load()) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });
});
