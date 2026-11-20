import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getUserRoles: vi.fn(), loadExpenseViewer: vi.fn() }));

vi.mock("~/lib/roles", () => ({ getUserRoles: m.getUserRoles }));
vi.mock("~/expenses/lib/viewer.server", () => ({ loadExpenseViewer: m.loadExpenseViewer }));

import type { McpCtx } from "~/mcp/registry";
import { mapToolError, McpForbiddenError, McpInvalidError } from "~/mcp/errors";
import { ExpenseError } from "~/expenses/lib/errors";
import { moneyToCents, parseDay, presentMoney, requireExpenseAccess, withViewer } from "../shared";

const ctx = { user: { id: "u1" }, scopes: [], request: new Request("https://os.example.edu/mcp") } as unknown as McpCtx;

beforeEach(() => {
  vi.resetAllMocks();
  m.getUserRoles.mockResolvedValue({ isLabMemberOrAlum: true, isAlumni: false });
  m.loadExpenseViewer.mockResolvedValue({ userId: "u1" });
});

describe("requireExpenseAccess", () => {
  it("allows current lab members", async () => {
    await expect(requireExpenseAccess(ctx)).resolves.toBeUndefined();
  });

  it.each([
    ["alumni", { isLabMemberOrAlum: true, isAlumni: true }],
    ["outsiders", { isLabMemberOrAlum: false, isAlumni: false }],
  ])("refuses %s with the same message", async (_n, roles) => {
    m.getUserRoles.mockResolvedValue(roles);
    const err = await requireExpenseAccess(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(McpForbiddenError);
    expect(err.message).toBe("Expenses are available to current lab members.");
  });
});

describe("withViewer", () => {
  it("runs the callback with the loaded viewer", async () => {
    expect(await withViewer(ctx, async (v) => v.userId)).toBe("u1");
  });

  it("does not load a viewer for a refused member", async () => {
    m.getUserRoles.mockResolvedValue({ isLabMemberOrAlum: true, isAlumni: true });
    await expect(withViewer(ctx, async () => 1)).rejects.toBeInstanceOf(McpForbiddenError);
    expect(m.loadExpenseViewer).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", -32003],
    ["not_found", -32004],
    ["invalid", -32602],
    ["conflict", -32602],
    ["incomplete", -32602],
  ] as const)("surfaces an expense %s error with its own message and JSON-RPC code %i", async (code, rpc) => {
    const err = await withViewer(ctx, async () => {
      throw new ExpenseError(code, "Original message.");
    }).catch((e) => e);
    expect(mapToolError(err)).toEqual({ code: rpc, message: "Original message." });
  });

  it("passes other errors through untouched", async () => {
    const boom = new Error("boom");
    await expect(withViewer(ctx, async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(mapToolError(boom)).toBeNull();
  });
});

describe("presentMoney", () => {
  it("swaps fooCents numbers for foo decimal strings, deeply", () => {
    expect(presentMoney({ id: "e1", totalCents: 1250, items: [{ amountCents: 5, note: "x" }], refundCents: null })).toEqual({
      id: "e1",
      total: "12.50",
      items: [{ amount: "0.05", note: "x" }],
      refund: null,
    });
  });

  it("leaves dates, primitives and non-numeric Cents fields alone", () => {
    const d = new Date("2026-01-01");
    expect(presentMoney({ at: d, Cents: 3, flagCents: "x" })).toEqual({ at: d, Cents: 3, flagCents: "x" });
    expect(presentMoney(null)).toBeNull();
    expect(presentMoney("a")).toBe("a");
  });
});

describe("moneyToCents", () => {
  it("parses decimal strings and passes null through", () => {
    expect(moneyToCents("12.50", "total")).toBe(1250);
    expect(moneyToCents(null, "total")).toBeNull();
  });

  it.each([12.5, "twelve", ""])("rejects %j with the field name", (raw) => {
    expect(() => moneyToCents(raw, "total")).toThrow(McpInvalidError);
    expect(() => moneyToCents(raw, "total")).toThrow('total must be a decimal string like "12.50".');
  });
});

describe("parseDay", () => {
  it("parses a calendar day as UTC midnight", () => {
    expect(parseDay("2026-11-17", "from").toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });

  it.each(["yesterday", "2026-1-5", 20261117, "2026-13-45"])("rejects %j", (raw) => {
    expect(() => parseDay(raw, "from")).toThrow("from must be a date like 2026-11-17.");
  });
});
