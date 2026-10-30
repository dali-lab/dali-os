import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));

import { prisma } from "~/lib/db";
import { isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { runBackfillTerms, BACKFILL_TERMS_TOOL } from "~/mcp/tools/admin/backfill-terms";
import type { McpCtx } from "~/mcp/registry";

const createMany = vi.fn();
const ctx = { user: { id: "admin-u1" }, request: new Request("https://example.com") } as unknown as McpCtx;
const term = (code: string) => ({ code, startDate: "2016-09-10", endDate: "2016-11-25" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAdmin).mockResolvedValue(true);
  createMany.mockResolvedValue({ count: 1 });
  (prisma as unknown as { term: { createMany: typeof createMany } }).term = { createMany };
});

describe("backfill_terms", () => {
  it("requires the mcp:admin scope", () => {
    expect(BACKFILL_TERMS_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("rejects a non-admin and writes nothing", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    await expect(runBackfillTerms(ctx, { terms: [term("16F")] })).rejects.toThrow("Only admins");
    expect(createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["13S", 2013, "S", 20132],
    ["16W", 2016, "W", 20161],
    ["16X", 2016, "X", 20163],
    ["17F", 2017, "F", 20174],
  ])("derives year, season, and sort key from %s", async (code, year, season, sortKey) => {
    await runBackfillTerms(ctx, { terms: [term(code)] });
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({ code, year, season, sortKey });
  });

  it("orders seasons W, S, X, F within a year", async () => {
    await runBackfillTerms(ctx, { terms: ["16F", "16X", "16S", "16W"].map(term) });
    const rows = createMany.mock.calls[0][0].data as { code: string; sortKey: number }[];
    const sorted = [...rows].sort((a, b) => a.sortKey - b.sortKey).map((r) => r.code);
    expect(sorted).toEqual(["16W", "16S", "16X", "16F"]);
  });

  it("never changes an existing term, and counts it as skipped", async () => {
    const result = await runBackfillTerms(ctx, { terms: [term("16F"), term("16X")] });
    expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(result).toEqual({ ok: true, requested: 2, created: 1, skipped: 1 });
  });

  it.each(["16Q", "2016F", "F16", ""])("rejects the term code %j", async (code) => {
    await expect(runBackfillTerms(ctx, { terms: [term(code)] })).rejects.toThrow("Invalid term code");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("rejects bad dates, and an end at or before the start", async () => {
    const bad = [
      { code: "16F", startDate: "nope", endDate: "2016-11-25" },
      { code: "16F", startDate: "2016-11-25", endDate: "2016-09-10" },
      { code: "16F", startDate: "2016-09-10", endDate: "2016-09-10" },
    ];
    for (const row of bad) {
      await expect(runBackfillTerms(ctx, { terms: [row] })).rejects.toThrow("Invalid dates");
    }
    expect(createMany).not.toHaveBeenCalled();
  });

  it("logs an audit event", async () => {
    await runBackfillTerms(ctx, { terms: [term("16F")] });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "term.backfill" }));
  });
});
