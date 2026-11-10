import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
const db = vi.hoisted(() => ({
  ipRule: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));

import { logAuditEvent } from "~/lib/audit";
import { setTtlCacheEnabledForTests } from "~/lib/ttl-cache";
import {
  AUTO_BLOCK_MS,
  _resetBlockedLogForTests,
  addIpRule,
  auditBlockedHit,
  autoBlockIp,
  buildMatchers,
  findOverlappingTrust,
  isIpBlocked,
  isIpTrusted,
  matches,
  normalizeCidr,
  rangesOverlap,
  removeIpRule,
} from "~/lib/ip-rules.server";

const mockAudit = vi.mocked(logAuditEvent);

function activeRules(rules: { kind: string; cidr: string }[]) {
  db.ipRule.findMany.mockResolvedValue(rules);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setTtlCacheEnabledForTests(true);
  _resetBlockedLogForTests();
  activeRules([]);
  db.ipRule.upsert.mockImplementation(async ({ create }: any) => ({ id: "r1", cidr: create.cidr }));
});

describe("normalizeCidr", () => {
  it.each([
    ["165.245.246.69", "165.245.246.69/32"],
    [" 129.170.0.0/16 ", "129.170.0.0/16"],
    ["0.0.0.0/0", "0.0.0.0/0"],
    ["2607:FB90::/32", "2607:fb90::/32"],
    ["2607:fb90::1", "2607:fb90::1/128"],
    ["::ffff:1.2.3.4", "1.2.3.4/32"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeCidr(input)).toBe(expected);
  });

  it.each([
    "",
    "not-an-ip",
    "1.2.3",
    "1.2.3.4/33",
    "2607::/129",
    "1.2.3.4/-1",
    "1.2.3.4/abc",
    "1.2.3.4/24/8",
    "999.1.1.1",
  ])("rejects %s", (input) => {
    expect(normalizeCidr(input)).toBeNull();
  });
});

describe("buildMatchers / matches", () => {
  const { block, trust } = buildMatchers([
    { kind: "block", cidr: "165.245.246.69/32" },
    { kind: "block", cidr: "2607:fb90::/32" },
    { kind: "trust", cidr: "129.170.0.0/16" },
    { kind: "trust", cidr: "garbage" },
    { kind: "other", cidr: "8.8.8.8/32" },
  ]);

  it("matches a single blocked address and nothing next to it", () => {
    expect(matches(block, "165.245.246.69")).toBe(true);
    expect(matches(block, "165.245.246.70")).toBe(false);
  });

  it("matches anywhere inside a trusted range", () => {
    expect(matches(trust, "129.170.212.19")).toBe(true);
    expect(matches(trust, "129.171.0.1")).toBe(false);
  });

  it("matches IPv6 ranges", () => {
    expect(matches(block, "2607:fb90:3c95:7720:d444:f0d4:2391:897d")).toBe(true);
    expect(matches(block, "2600:1000::1")).toBe(false);
  });

  it("matches an IPv4-mapped IPv6 address as its IPv4 form", () => {
    expect(matches(block, "::ffff:165.245.246.69")).toBe(true);
  });

  it("keeps kinds apart and skips unknown kinds and bad ranges", () => {
    expect(matches(trust, "165.245.246.69")).toBe(false);
    expect(matches(block, "129.170.1.1")).toBe(false);
    expect(matches(block, "8.8.8.8")).toBe(false);
  });

  it("never matches an unparseable address", () => {
    expect(matches(block, "unknown")).toBe(false);
    expect(matches(block, "")).toBe(false);
  });
});

describe("rangesOverlap", () => {
  it.each([
    ["129.170.0.0/16", "129.170.212.19", true],
    ["129.170.212.19", "129.170.0.0/16", true],
    ["129.170.0.0/16", "129.170.0.0/8", true],
    ["129.170.0.0/16", "165.245.246.69", false],
    ["129.170.0.0/16", "bad", false],
  ])("%s vs %s → %s", (a, b, expected) => {
    expect(rangesOverlap(a, b)).toBe(expected);
  });
});

describe("findOverlappingTrust", () => {
  it("returns the trusted range a block would fall inside", async () => {
    activeRules([{ kind: "trust", cidr: "129.170.0.0/16" }]);
    expect(await findOverlappingTrust("129.170.212.19/32")).toBe("129.170.0.0/16");
    expect(await findOverlappingTrust("165.245.246.69/32")).toBeNull();
  });
});

describe("isIpBlocked / isIpTrusted", () => {
  it("reads only unexpired rules", async () => {
    await isIpBlocked("1.1.1.1");
    expect(db.ipRule.findMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] },
      select: { kind: true, cidr: true },
    });
  });

  it("answers from the active rules", async () => {
    activeRules([
      { kind: "block", cidr: "165.245.246.69/32" },
      { kind: "trust", cidr: "129.170.0.0/16" },
    ]);
    expect(await isIpBlocked("165.245.246.69")).toBe(true);
    expect(await isIpBlocked("129.170.1.1")).toBe(false);
    expect(await isIpTrusted("129.170.1.1")).toBe(true);
    expect(await isIpTrusted("165.245.246.69")).toBe(false);
  });

  it("caches the rules between checks", async () => {
    await isIpBlocked("1.1.1.1");
    await isIpTrusted("1.1.1.1");
    expect(db.ipRule.findMany).toHaveBeenCalledTimes(1);
  });

  it("fails open when the rules can't be read", async () => {
    db.ipRule.findMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isIpBlocked("165.245.246.69")).toBe(false);
    expect(await isIpTrusted("129.170.1.1")).toBe(false);
  });
});

describe("addIpRule / removeIpRule", () => {
  it("upserts the normalized range and drops the cache so the rule applies at once", async () => {
    expect(await isIpBlocked("165.245.246.69")).toBe(false);
    activeRules([{ kind: "block", cidr: "165.245.246.69/32" }]);
    await addIpRule({ kind: "block", cidr: "165.245.246.69", reason: "x", createdByUserId: "u1" });
    expect(db.ipRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind_cidr: { kind: "block", cidr: "165.245.246.69/32" } },
        create: expect.objectContaining({ kind: "block", cidr: "165.245.246.69/32", source: "manual" }),
      }),
    );
    expect(await isIpBlocked("165.245.246.69")).toBe(true);
  });

  it("rejects an invalid range without writing", async () => {
    await expect(addIpRule({ kind: "block", cidr: "nope" })).rejects.toThrow(/Invalid/);
    expect(db.ipRule.upsert).not.toHaveBeenCalled();
  });

  it("removes a rule and reports what it was", async () => {
    db.ipRule.findUnique.mockResolvedValue({ kind: "block", cidr: "1.2.3.4/32" });
    expect(await removeIpRule("r1")).toEqual({ kind: "block", cidr: "1.2.3.4/32" });
    expect(db.ipRule.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
  });

  it("returns null for a rule that's already gone", async () => {
    db.ipRule.findUnique.mockResolvedValue(null);
    expect(await removeIpRule("r1")).toBeNull();
    expect(db.ipRule.delete).not.toHaveBeenCalled();
  });
});

describe("autoBlockIp", () => {
  it("blocks an outside address for 24 hours and audits it", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(await autoBlockIp("165.245.246.69", "3 refused")).toBe(true);
    expect(db.ipRule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          kind: "block",
          cidr: "165.245.246.69/32",
          source: "auto",
          expiresAt: new Date(now + AUTO_BLOCK_MS),
        }),
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith({
      action: "security.ip.autoblock",
      metadata: { cidr: "165.245.246.69/32", reason: "3 refused" },
      ip: "165.245.246.69",
    });
  });

  it("never blocks an address on a trusted network", async () => {
    activeRules([{ kind: "trust", cidr: "129.170.0.0/16" }]);
    expect(await autoBlockIp("129.170.212.19", "3 refused")).toBe(false);
    expect(db.ipRule.upsert).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("ignores an unparseable address", async () => {
    expect(await autoBlockIp("unknown", "x")).toBe(false);
    expect(db.ipRule.upsert).not.toHaveBeenCalled();
  });
});

describe("auditBlockedHit", () => {
  it("logs at most one row per address per minute", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    await auditBlockedHit("1.2.3.4", "/a", "curl");
    await auditBlockedHit("1.2.3.4", "/b", "curl");
    await auditBlockedHit("5.6.7.8", "/a", null);
    expect(mockAudit).toHaveBeenCalledTimes(2);
    expect(mockAudit).toHaveBeenCalledWith({
      action: "security.ip.blocked",
      metadata: { path: "/a" },
      ip: "1.2.3.4",
      userAgent: "curl",
    });
    clock.mockReturnValue(now + 61_000);
    await auditBlockedHit("1.2.3.4", "/c", "curl");
    expect(mockAudit).toHaveBeenCalledTimes(3);
  });
});
