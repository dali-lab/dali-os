import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: () => null,
}));
vi.mock("~/lib/notebooks.server", () => {
  class NotebookError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  }
  return {
    NotebookError,
    notebookErrorResponse: (err: unknown) => {
      if (err instanceof NotebookError) return Response.json({ error: err.message }, { status: err.status });
      throw err;
    },
    setSeriesNotebook: vi.fn(),
  };
});

import { requireMemberSession } from "~/lib/auth";
import { NotebookError, setSeriesNotebook } from "~/lib/notebooks.server";
import { action } from "../api.scheduled-meetings.$id.notebook";

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://os.test/api/scheduled-meetings/m1/notebook", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    params: { id: "m1" },
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(setSeriesNotebook).mockResolvedValue({ moved: 2, skipped: 1 });
});

describe("POST /api/scheduled-meetings/:id/notebook", () => {
  it("sets the series notebook and reports what moved", async () => {
    const res = await post({ notebookId: "nb1", scope: "all" });
    expect(await res.json()).toEqual({ ok: true, moved: 2, skipped: 1 });
    expect(setSeriesNotebook).toHaveBeenCalledWith("m1", "nb1", { scope: "all" }, "u1");
  });

  it("unsets it with null", async () => {
    await post({ notebookId: null, scope: "future" });
    expect(setSeriesNotebook).toHaveBeenCalledWith("m1", null, { scope: "future" }, "u1");
  });

  it("400s a missing or unknown scope", async () => {
    expect((await post({ notebookId: "nb1" })).status).toBe(400);
    expect((await post({ notebookId: "nb1", scope: "some" })).status).toBe(400);
    expect(setSeriesNotebook).not.toHaveBeenCalled();
  });

  it("returns the session gate's response when not a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    expect((await post({ notebookId: "nb1", scope: "all" })).status).toBe(403);
    expect(setSeriesNotebook).not.toHaveBeenCalled();
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "PUT")).status).toBe(405);
  });

  it("maps the organizer-or-Core gate to 403", async () => {
    vi.mocked(setSeriesNotebook).mockRejectedValue(new NotebookError("Only the organizer or Core can change a meeting's notebook", 403));
    expect((await post({ notebookId: "nb1", scope: "all" })).status).toBe(403);
  });
});
