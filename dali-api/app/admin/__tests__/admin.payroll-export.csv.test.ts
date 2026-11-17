import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const requireAuth = vi.fn();
const isAdmin = vi.fn();
const redirectToLogin = vi.fn();
vi.mock("~/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  forbidden: () => Response.json({ error: "Forbidden" }, { status: 403 }),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: (...a: unknown[]) => redirectToLogin(...a) }));
vi.mock("~/lib/roles", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));

const buildPayrollRows = vi.fn();
const buildCoreRows = vi.fn();
const buildInstructorRows = vi.fn();
const buildTechnigalaRows = vi.fn();
vi.mock("~/admin/lib/payroll-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/admin/lib/payroll-export")>()),
  buildPayrollRows: (...a: unknown[]) => buildPayrollRows(...a),
  buildCoreRows: (...a: unknown[]) => buildCoreRows(...a),
  buildInstructorRows: (...a: unknown[]) => buildInstructorRows(...a),
  buildTechnigalaRows: (...a: unknown[]) => buildTechnigalaRows(...a),
}));

import { prisma } from "~/lib/db.server";
import { loader } from "../routes/admin.payroll-export.csv";

const termFindMany = (prisma as unknown as { term: { findMany: ReturnType<typeof vi.fn> } }).term.findMany;

const run = (query = "") =>
  loader({ request: new Request(`https://os.example/admin/payroll-export.csv${query}`) } as never) as Promise<Response>;

const fall = { id: "t-fall", code: "26F", startDate: new Date("2026-09-14"), endDate: new Date("2026-11-20") };
const summer = { id: "t-sum", code: "26X", startDate: new Date("2026-06-22"), endDate: new Date("2026-08-30") };

const row = (over: Record<string, unknown> = {}) => ({
  netId: "f00abc1",
  firstName: "Ada",
  lastName: "Lovelace",
  jobId: "1",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  requireAuth.mockResolvedValue({ ok: true, user: { sub: "admin1" } });
  isAdmin.mockResolvedValue(true);
  redirectToLogin.mockReturnValue(new Response(null, { status: 302 }));
  termFindMany.mockResolvedValue([fall, summer]);
  buildPayrollRows.mockResolvedValue([]);
  buildCoreRows.mockResolvedValue([]);
  buildInstructorRows.mockResolvedValue([]);
  buildTechnigalaRows.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("admin.payroll-export.csv loader", () => {
  it("redirects an unauthenticated request to login without touching the db", async () => {
    requireAuth.mockResolvedValue({ ok: false });
    const res = await run();
    expect(res.status).toBe(302);
    expect(termFindMany).not.toHaveBeenCalled();
  });

  it("forbids a non-admin and builds no rows", async () => {
    isAdmin.mockResolvedValue(false);
    const res = await run();
    expect(res.status).toBe(403);
    expect(termFindMany).not.toHaveBeenCalled();
    expect(buildPayrollRows).not.toHaveBeenCalled();
  });

  it("falls back to the default term for an unknown ?term", async () => {
    await run("?term=nope");
    expect(buildPayrollRows.mock.calls[0][0]).toBe("t-fall");
  });

  it("uses a known ?term", async () => {
    const res = await run("?term=t-sum");
    expect(buildPayrollRows.mock.calls[0][0]).toBe("t-sum");
    expect(res.headers.get("Content-Disposition")).toContain("payroll-26X-");
  });

  it("returns 404 when there are no terms", async () => {
    termFindMany.mockResolvedValue([]);
    const res = await run();
    expect(res.status).toBe(404);
    expect(buildPayrollRows).not.toHaveBeenCalled();
  });

  it("drops invalid ?level values and dedupes and trims ?domain", async () => {
    await run("?level=P1,bogus,P3&domain=a,,%20a%20,b");
    const [, filter] = buildPayrollRows.mock.calls[0];
    expect(filter.domainIds).toEqual(["a", "b"]);
    expect(filter.levels).toEqual(["P1", "P3"]);
  });

  it("passes core, instructor and technigala ids to their builders as Sets", async () => {
    await run("?core=u1,u2&instructor=u3&technigala=u4,,u5");
    expect(buildCoreRows).toHaveBeenCalledWith("t-fall", new Set(["u1", "u2"]));
    expect(buildInstructorRows).toHaveBeenCalledWith("t-fall", new Set(["u3"]));
    expect(buildTechnigalaRows).toHaveBeenCalledWith("t-fall", new Set(["u4", "u5"]));
  });

  it("passes empty Sets when the id params are absent", async () => {
    await run();
    expect(buildCoreRows).toHaveBeenCalledWith("t-fall", new Set());
  });

  it("sets csv headers with a dated filename and no-store", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="payroll-26F-2026-10-05.csv"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("escapes commas and quotes in names", async () => {
    buildPayrollRows.mockResolvedValue([row({ lastName: 'Lovelace, "Countess"' })]);
    const text = await (await run()).text();
    expect(text).toContain('"Lovelace, ""Countess"""');
  });
});
