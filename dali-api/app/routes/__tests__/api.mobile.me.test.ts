import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const requireMobileUser = vi.fn();
const currentTerm = vi.fn();
const listActiveGroupNamesForUser = vi.fn();
const memberSummaryFor = vi.fn();
const termFactsForUser = vi.fn();

vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/lib/roles", () => ({ currentTerm: (...a: unknown[]) => currentTerm(...a) }));
vi.mock("~/lib/groups", () => ({ listActiveGroupNamesForUser: (...a: unknown[]) => listActiveGroupNamesForUser(...a) }));
vi.mock("~/lib/mobile-members.server", () => ({
  memberSummaryFor: (...a: unknown[]) => memberSummaryFor(...a),
  termFactsForUser: (...a: unknown[]) => termFactsForUser(...a),
}));

import { mockedPrisma } from "~/test-utils/prisma";
import { loader, action } from "../api.mobile.me";

const db = mockedPrisma();

const dbUser = {
  netId: "f00abc1",
  classYear: 2028,
  currentLocation: "Hanover, NH",
  timeZone: "America/New_York",
  daliEmail: "ada@dali.example",
  dartmouthEmail: "ada@dartmouth.example",
  personalEmail: "ada@example.edu",
  phoneNumber: "555-0100",
  githubUsername: "ada",
  domainEligibilities: [{ level: "P2", domain: { displayName: "Design" } }],
};
const summary = { id: "u1", name: "Ada Lovelace" };

const getReq = () => new Request("https://os.example/api/mobile/me");
const put = (body: unknown, method = "PUT") =>
  new Request("https://os.example/api/mobile/me", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const load = () => loader({ request: getReq() } as never) as Promise<Response>;
const act = (request: Request) => action({ request } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1" });
  currentTerm.mockResolvedValue({ code: "26F" });
  listActiveGroupNamesForUser.mockResolvedValue(["Core"]);
  memberSummaryFor.mockResolvedValue(summary);
  termFactsForUser.mockResolvedValue({ coreLeadTitle: "Director", domainLeadOf: [] });
  db.user.findUnique.mockResolvedValue(dbUser as never);
});

describe("GET /api/mobile/me", () => {
  it("passes the guard failure response through", async () => {
    const denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    requireMobileUser.mockResolvedValue({ ok: false, response: denied });
    expect(await load()).toBe(denied);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when the user row is missing", async () => {
    db.user.findUnique.mockResolvedValue(null as never);
    expect((await load()).status).toBe(404);
  });

  it("returns 404 when the member summary is missing", async () => {
    memberSummaryFor.mockResolvedValue(null);
    expect((await load()).status).toBe(404);
  });

  it("locks the response key set", async () => {
    const res = await load();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["basedIn", "classYear", "domainLevels", "emails", "github", "groups", "leadRoles", "netId", "phone", "timeZone", "user"].sort(),
    );
    expect(body.user).toEqual(summary);
    expect(body.emails).toEqual(["ada@dali.example", "ada@dartmouth.example", "ada@example.edu"]);
    expect(body.domainLevels).toEqual([{ domain: "Design", level: "P2" }]);
    expect(body.groups).toEqual(["Core"]);
  });

  it("sends Cache-Control no-store", async () => {
    expect((await load()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns empty leadRoles when there are no term facts", async () => {
    termFactsForUser.mockResolvedValue(null);
    expect((await (await load()).json()).leadRoles).toEqual([]);
  });
});

describe("PUT /api/mobile/me", () => {
  it("returns 405 for a non-PUT method", async () => {
    const res = await act(put({ status: "away" }, "POST"));
    expect(res.status).toBe(405);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid status and writes nothing", async () => {
    const res = await act(put({ status: "busy" }));
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const res = await act(new Request("https://os.example/api/mobile/me", { method: "PUT", body: "{nope" }));
    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("passes the guard failure through without writing", async () => {
    const denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    requireMobileUser.mockResolvedValue({ ok: false, response: denied });
    expect(await act(put({ status: "away" }))).toBe(denied);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("sets presenceAway true for away, scoped to the guard user even if the body names another", async () => {
    const res = await act(put({ status: "away", userId: "someone-else" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { presenceAway: true } });
  });

  it("sets presenceAway false for active", async () => {
    await act(put({ status: "active" }));
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { presenceAway: false } });
  });
});
