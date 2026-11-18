import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  isImpersonating: vi.fn(),
  impersonationAllowsWrites: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
  loadExpenseViewer: vi.fn(),
  createReceiptUpload: vi.fn(),
  exportExpensesCsv: vi.fn(),
  exportExpensesPdf: vi.fn(),
  openReceipt: vi.fn(),
  receiptLink: vi.fn(),
  isS3Configured: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/auth", () => ({
  requireAuth: m.requireAuth,
  isNonMember: m.isNonMember,
  isImpersonating: m.isImpersonating,
  impersonationAllowsWrites: m.impersonationAllowsWrites,
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: m.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("../../lib/viewer.server", () => ({ loadExpenseViewer: m.loadExpenseViewer }));
vi.mock("../../lib/receipts.server", async () => {
  class ReceiptKeyError extends Error {}
  return { createReceiptUpload: m.createReceiptUpload, ReceiptKeyError };
});
vi.mock("../../lib/export.server", () => ({ exportExpensesCsv: m.exportExpensesCsv, exportExpensesPdf: m.exportExpensesPdf }));
vi.mock("../../lib/expenses.server", () => ({ openReceipt: m.openReceipt, receiptLink: m.receiptLink }));
vi.mock("~/lib/s3.server", () => ({ isS3Configured: m.isS3Configured }));

import { ExpenseError } from "../../lib/errors";
import { ReceiptKeyError } from "../../lib/receipts.server";
import { action as upload } from "../expenses.upload";
import { loader as exportLoader } from "../expenses.export";
import { loader as receiptLoader } from "../expenses.receipt";
import { parseExpenseFilters, parseScope } from "../filters";

const viewer = { userId: "u1", isCore: true, isStaff: true, ownedCardIds: [] };

beforeEach(() => {
  vi.resetAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  m.isNonMember.mockResolvedValue(false);
  m.isImpersonating.mockReturnValue(false);
  m.getUserRoles.mockResolvedValue({ isAlumni: false });
  m.isFeatureEnabled.mockResolvedValue(true);
  m.loadExpenseViewer.mockResolvedValue(viewer);
});

const presign = (body: unknown, method = "POST") =>
  upload({ request: new Request("https://os.example/expenses/upload", { method, body: method === "POST" ? JSON.stringify(body) : undefined }) } as never) as Promise<Response>;

describe("POST /expenses/upload", () => {
  it("presigns one upload per file for the caller", async () => {
    m.createReceiptUpload.mockImplementation(async (_u: string, t: string) => ({ key: `k-${t}`, post: { url: "u", fields: {} }, contentType: t }));
    const r = await presign({ contentTypes: ["image/jpeg", "application/pdf"] });
    expect(m.createReceiptUpload).toHaveBeenCalledWith("u1", "image/jpeg");
    expect((await r.json()).uploads.map((u: { key: string }) => u.key)).toEqual(["k-image/jpeg", "k-application/pdf"]);
  });
  it("404s when the flag is off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect((await presign({ contentTypes: ["image/jpeg"] })).status).toBe(404);
    expect(m.createReceiptUpload).not.toHaveBeenCalled();
  });
  it("401s when signed out", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect((await presign({ contentTypes: ["image/jpeg"] })).status).toBe(401);
  });
  it.each([[{}], [{ contentTypes: [] }], [{ contentTypes: [1] }], [{ contentTypes: Array(13).fill("image/jpeg") }]])("rejects %j", async (body) => {
    expect((await presign(body)).status).toBe(400);
  });
  it("shows the library's message for a type it won't take", async () => {
    m.createReceiptUpload.mockRejectedValue(new ReceiptKeyError("Receipts can be JPEG, PNG, WebP or PDF files."));
    const r = await presign({ contentTypes: ["image/gif"] });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/JPEG, PNG, WebP or PDF/);
  });
  it("rejects other methods", async () => {
    expect((await presign(null, "PUT")).status).toBe(405);
  });
});

const exporter = (qs: string) => exportLoader({ request: new Request(`https://os.example/expenses/export?${qs}`) } as never) as Promise<Response>;

describe("GET /expenses/export", () => {
  it("returns a CSV download for the scope and filters", async () => {
    m.exportExpensesCsv.mockResolvedValue("id,status\r\n");
    const r = await exporter("format=csv&scope=all&status=APPROVED&cardId=k1");
    expect(m.exportExpensesCsv).toHaveBeenCalledWith(viewer, "all", { status: ["APPROVED"], cardId: "k1" });
    expect(r.headers.get("Content-Type")).toContain("text/csv");
    expect(r.headers.get("Content-Disposition")).toContain("attachment");
    expect(await r.text()).toBe("id,status\r\n");
  });
  it("returns a PDF download", async () => {
    m.exportExpensesPdf.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    const r = await exporter("format=pdf&scope=mine");
    expect(m.exportExpensesPdf).toHaveBeenCalledWith(viewer, "mine", {});
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
  });
  it("defaults an unknown scope to your own expenses", async () => {
    m.exportExpensesCsv.mockResolvedValue("");
    await exporter("format=csv&scope=everything");
    expect(m.exportExpensesCsv).toHaveBeenCalledWith(viewer, "mine", {});
  });
  it("rejects an unknown format", async () => {
    expect((await exporter("format=xlsx")).status).toBe(400);
  });
  it("404s when the flag is off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect((await exporter("format=csv")).status).toBe(404);
    expect(m.exportExpensesCsv).not.toHaveBeenCalled();
  });
  it("maps a library refusal to its status", async () => {
    m.exportExpensesCsv.mockRejectedValue(new ExpenseError("forbidden", "Only Core can see every expense."));
    const r = await exporter("format=csv&scope=all");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("Only Core can see every expense.");
  });
});

describe("parseExpenseFilters", () => {
  it("reads every filter", () => {
    expect(parseExpenseFilters(new URLSearchParams("status=DRAFT,PAID&cardId=k&categoryId=c&termId=t&from=2026-01-02&to=2026-03-04&noReceipt=1&outstanding=1"))).toEqual({
      status: ["DRAFT", "PAID"], cardId: "k", categoryId: "c", termId: "t",
      from: new Date("2026-01-02T00:00:00Z"), to: new Date("2026-03-04T00:00:00Z"), noReceipt: true, outstanding: true,
    });
  });
  it("drops unknown statuses and bad dates", () => {
    expect(parseExpenseFilters(new URLSearchParams("status=BOGUS&from=yesterday&to=2026-13-40"))).toEqual({});
  });
  it("parses scope with a safe default", () => {
    expect(parseScope("all")).toBe("all");
    expect(parseScope("approvals")).toBe("approvals");
    expect(parseScope("x")).toBe("mine");
    expect(parseScope(null)).toBe("mine");
  });
});

describe("GET /expenses/receipts/:receiptId", () => {
  const fetchReceipt = (receiptId = "r1", query = "") =>
    receiptLoader({ request: new Request(`https://os.example/expenses/receipts/${receiptId}${query}`), params: { receiptId } } as never) as Promise<Response>;

  beforeEach(() => m.isS3Configured.mockReturnValue(true));

  it("streams the file from this site so it can show in a frame", async () => {
    m.openReceipt.mockResolvedValue({
      body: new Response("%PDF-1.7").body,
      contentType: "application/pdf",
    });
    const r = await fetchReceipt();
    expect(m.openReceipt).toHaveBeenCalledWith(viewer, "r1");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toBe("inline");
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await r.text()).toBe("%PDF-1.7");
  });
  it("returns a fresh signed link for the desktop app with ?link=1", async () => {
    m.receiptLink.mockResolvedValue("https://s3.example/r1?sig");
    const r = await fetchReceipt("r1", "?link=1");
    expect(await r.json()).toEqual({ url: "https://s3.example/r1?sig" });
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(m.receiptLink).toHaveBeenCalledWith(viewer, "r1");
    expect(m.openReceipt).not.toHaveBeenCalled();
    m.receiptLink.mockRejectedValue(new ExpenseError("not_found", "Receipt not found."));
    expect((await fetchReceipt("r1", "?link=1")).status).toBe(404);
  });
  it("is not found when the caller can't see it", async () => {
    m.openReceipt.mockRejectedValue(new ExpenseError("not_found", "Receipt not found."));
    expect((await fetchReceipt()).status).toBe(404);
  });
  it("says files are unavailable without storage", async () => {
    m.isS3Configured.mockReturnValue(false);
    expect((await fetchReceipt()).status).toBe(503);
    expect(m.openReceipt).not.toHaveBeenCalled();
  });
  it("needs a signed-in member with expenses on", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect((await fetchReceipt()).status).toBe(401);
    m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    m.isFeatureEnabled.mockResolvedValue(false);
    expect((await fetchReceipt()).status).toBe(404);
    expect(m.openReceipt).not.toHaveBeenCalled();
  });
});
