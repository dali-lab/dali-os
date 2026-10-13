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
    attachNote: vi.fn(),
    detachNote: vi.fn(),
  };
});

import { requireMemberSession } from "~/lib/auth";
import { NotebookError, attachNote, detachNote } from "~/lib/notebooks.server";
import { action } from "~/routes/api.pages.$id.meeting";

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://os.test/api/pages/d1/meeting", {
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

describe("POST /api/pages/:id/meeting", () => {
  it("detach-meeting turns the note into a plain doc", async () => {
    const res = await post({ intent: "detach-meeting" });
    expect(res.status).toBe(200);
    expect(detachNote).toHaveBeenCalledWith("d1", "u1");
  });

  it("attach-meeting passes the occurrence as a Date and reports the notebook move", async () => {
    vi.mocked(attachNote).mockResolvedValue({ movedIntoNotebook: true });
    const res = await post({ intent: "attach-meeting", meetingId: "m1", occurrenceStart: "2026-09-10T15:00:00.000Z" });
    expect(await res.json()).toEqual({ ok: true, movedIntoNotebook: true });
    expect(attachNote).toHaveBeenCalledWith("d1", "m1", new Date("2026-09-10T15:00:00.000Z"), "u1");
  });

  it("attach-meeting without an occurrence means the first one", async () => {
    vi.mocked(attachNote).mockResolvedValue({ movedIntoNotebook: false });
    await post({ intent: "attach-meeting", meetingId: "m1" });
    expect(attachNote).toHaveBeenCalledWith("d1", "m1", null, "u1");
  });

  it("returns the session gate's response when not a member", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({
      ok: false,
      response: new Response("no", { status: 403 }),
    } as never);
    expect((await post({ intent: "detach-meeting" })).status).toBe(403);
    expect(detachNote).not.toHaveBeenCalled();
  });

  it("400s an unknown intent, a missing meeting or a bad date", async () => {
    expect((await post({ intent: "nope" })).status).toBe(400);
    expect((await post({ intent: "attach-meeting" })).status).toBe(400);
    expect((await post({ intent: "attach-meeting", meetingId: "m1", occurrenceStart: "tuesday" })).status).toBe(400);
    expect(attachNote).not.toHaveBeenCalled();
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "PUT")).status).toBe(405);
  });

  it("maps a taken occurrence to 409", async () => {
    vi.mocked(attachNote).mockRejectedValue(new NotebookError("That occurrence already has a note", 409));
    const res = await post({ intent: "attach-meeting", meetingId: "m1" });
    expect(res.status).toBe(409);
  });

  it("maps a detach refusal to its status", async () => {
    vi.mocked(detachNote).mockRejectedValue(new NotebookError("You can't edit this document", 403));
    expect((await post({ intent: "detach-meeting" })).status).toBe(403);
  });
});
