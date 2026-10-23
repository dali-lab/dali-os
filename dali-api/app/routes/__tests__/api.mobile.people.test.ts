import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

const requireMobileUser = vi.fn();
const runSearchDirectory = vi.fn();
const listMemberSummaries = vi.fn();
vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/mcp/tools/search-directory", () => ({ runSearchDirectory: (...a: unknown[]) => runSearchDirectory(...a) }));
vi.mock("~/lib/mobile-members.server", () => ({ listMemberSummaries: (...a: unknown[]) => listMemberSummaries(...a) }));

import { loader } from "../api.mobile.people";

const get = (q: string) => loader({ request: new Request(`https://os.example/api/mobile/people?q=${encodeURIComponent(q)}`) } as never) as Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileUser.mockResolvedValue({ ok: true, userId: "u1" });
  runSearchDirectory.mockResolvedValue({ results: [{ id: "u2" }, { id: "u3" }] });
  listMemberSummaries.mockResolvedValue([{ id: "u2", name: "Kiran" }, { id: "u3", name: "Kim" }]);
});

describe("GET /api/mobile/people", () => {
  it("returns summaries for the directory matches", async () => {
    expect(await (await get("ki")).json()).toEqual({ people: [{ id: "u2", name: "Kiran" }, { id: "u3", name: "Kim" }] });
    expect(runSearchDirectory).toHaveBeenCalledWith({ query: "ki", limit: 15 });
    expect(listMemberSummaries).toHaveBeenCalledWith(["u2", "u3"]);
  });

  it.each(["", "k", "  k  "])("doesn't search for %j", async (q) => {
    expect(await (await get(q)).json()).toEqual({ people: [] });
    expect(runSearchDirectory).not.toHaveBeenCalled();
  });

  it("returns the guard's response for a member it doesn't let in", async () => {
    const response = new Response(null, { status: 404 });
    requireMobileUser.mockResolvedValue({ ok: false, response });
    expect(await get("kiran")).toBe(response);
  });
});
