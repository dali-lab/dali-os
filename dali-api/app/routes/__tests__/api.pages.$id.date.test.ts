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
    setNoteDate: vi.fn(),
  };
});

import { requireMemberSession } from "~/lib/auth";
import { NotebookError, setNoteDate } from "~/lib/notebooks.server";
import { action } from "~/routes/api.pages.$id.date";

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://os.test/api/pages/d1/date", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    params: { id: "d1" },
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
});

describe("POST /api/pages/:id/date", () => {
  it("passes the YYYY-MM-DD date as midnight ET to setNoteDate", async () => {
    const res = await post({ date: "2026-10-14" });
    expect(res.status).toBe(200);
    const [, instant] = vi.mocked(setNoteDate).mock.calls[0]!;
    // Oct 14 2026 is DST (EDT, UTC-4), so midnight ET is 04:00 UTC.
    expect((instant as Date).toISOString()).toBe("2026-10-14T04:00:00.000Z");
    expect(vi.mocked(setNoteDate).mock.calls[0]).toEqual(["d1", expect.any(Date), "u1"]);
  });

  it("passes null through to clear the date", async () => {
    const res = await post({ date: null });
    expect(res.status).toBe(200);
    expect(setNoteDate).toHaveBeenCalledWith("d1", null, "u1");
  });

  it.each([
    ["2026-01-14", "2026-01-14T05:00:00.000Z"],
    ["2026-03-08", "2026-03-08T05:00:00.000Z"],
    ["2026-03-09", "2026-03-09T04:00:00.000Z"],
    ["2026-11-01", "2026-11-01T04:00:00.000Z"],
    ["2026-11-02", "2026-11-02T05:00:00.000Z"],
    ["2028-02-29", "2028-02-29T05:00:00.000Z"],
  ])("converts %s to midnight ET", async (date, instant) => {
    expect((await post({ date })).status).toBe(200);
    expect(setNoteDate).toHaveBeenCalledWith("d1", new Date(instant), "u1");
  });

  it.each(["2026-02-30", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "0099-01-01"])(
    "rejects %s without saving a normalized date",
    async (date) => {
      expect((await post({ date })).status).toBe(400);
      expect(setNoteDate).not.toHaveBeenCalled();
    },
  );

  it("returns the session gate's response when not a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    expect((await post({ date: "2026-10-14" })).status).toBe(403);
    expect(setNoteDate).not.toHaveBeenCalled();
  });

  it("400s a malformed date or a missing body", async () => {
    expect((await post({ date: "tuesday" })).status).toBe(400);
    expect((await post({ date: "2026-10" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(setNoteDate).not.toHaveBeenCalled();
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "PUT")).status).toBe(405);
  });

  it("maps a notebook refusal to its status", async () => {
    vi.mocked(setNoteDate).mockRejectedValue(
      new NotebookError("A note linked to a meeting takes its date from the meeting", 400),
    );
    const res = await post({ date: "2026-10-14" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "A note linked to a meeting takes its date from the meeting" });
  });
});
