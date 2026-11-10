import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  handlePreflight: vi.fn(() => null),
  withCors: (_req: Request, res: Response) => res,
}));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { handlePreflight } from "~/lib/cors";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { loader, action } from "~/hiring/routes/api.cycles.$cycleId.my-interviews.$interviewId.notes";

const db = prisma as any;

const args = (method: string, body?: unknown) =>
  ({
    request: new Request("http://localhost/api/hiring/cycles/c1/my-interviews/iv1/notes", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    params: { cycleId: "c1", interviewId: "iv1" },
    context: {},
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handlePreflight).mockReturnValue(null);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } } as any);
  vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(null as any);
  db.dALIMember = { findUnique: vi.fn().mockResolvedValue({ userId: "ada" }) };
  db.cycleInterviewer = { findMany: vi.fn().mockResolvedValue([{ id: "ci-a" }, { id: "ci-b" }]) };
  db.interviewAssignment = { findFirst: vi.fn().mockResolvedValue({ id: "asg1" }) };
  db.interviewNoteVersion = {
    findMany: vi.fn().mockResolvedValue([{ id: "v2" }, { id: "v1" }]),
    create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "v3", ...data })),
  };
});

describe("assignment lookup (shared by loader and action)", () => {
  it("matches an Active assignment across all of the member's interviewer rows in the cycle", async () => {
    await loader(args("GET"));

    expect(db.cycleInterviewer.findMany).toHaveBeenCalledWith({
      where: { userId: "ada", applicationCycleId: "c1" },
      select: { id: true },
    });
    expect(db.interviewAssignment.findFirst).toHaveBeenCalledWith({
      where: { interviewId: "iv1", cycleInterviewerId: { in: ["ci-a", "ci-b"] }, status: "Active" },
    });
  });

  it.each([
    ["not a DALI member", () => (db.dALIMember.findUnique = vi.fn().mockResolvedValue(null))],
    ["not an interviewer in this cycle", () => db.cycleInterviewer.findMany.mockResolvedValue([])],
    ["not assigned to this interview (or the assignment is no longer Active)", () => db.interviewAssignment.findFirst.mockResolvedValue(null)],
  ])("404s a caller who is %s, for both reads and writes", async (_l, setup) => {
    setup();

    const read = await loader(args("GET"));
    const write = await action(args("POST", { content: "x" }));

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    expect(db.interviewNoteVersion.findMany).not.toHaveBeenCalled();
    expect(db.interviewNoteVersion.create).not.toHaveBeenCalled();
  });
});

describe("GET notes", () => {
  it("returns this interviewer's versions, newest first", async () => {
    const res = await loader(args("GET"));

    expect(await res.json()).toEqual([{ id: "v2" }, { id: "v1" }]);
    expect(db.interviewNoteVersion.findMany).toHaveBeenCalledWith({
      where: { interviewAssignmentId: "asg1" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("answers CORS preflight without authenticating", async () => {
    vi.mocked(handlePreflight).mockReturnValue(new Response(null, { status: 204 }));

    expect((await loader(args("OPTIONS"))).status).toBe(204);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("returns the auth failure", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as any);

    expect((await loader(args("GET"))).status).toBe(401);
  });

  it("is blocked until the confidentiality agreement is signed", async () => {
    vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(new Response("sign first", { status: 403 }) as any);

    expect((await loader(args("GET"))).status).toBe(403);
    expect(requireApiSignedOrForbidden).toHaveBeenCalledWith("ada", "c1");
    expect(db.interviewNoteVersion.findMany).not.toHaveBeenCalled();
  });
});

describe("POST notes", () => {
  it("appends a new version to the caller's own assignment", async () => {
    const res = await action(args("POST", { content: "Strong systems answers" }));

    expect(res.status).toBe(201);
    expect(db.interviewNoteVersion.create).toHaveBeenCalledWith({
      data: { interviewAssignmentId: "asg1", content: "Strong systems answers" },
    });
    expect(await res.json()).toMatchObject({ interviewAssignmentId: "asg1" });
  });

  it("rejects other methods", async () => {
    expect((await action(args("PUT", { content: "x" }))).status).toBe(405);
  });

  it("is blocked until the confidentiality agreement is signed", async () => {
    vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(new Response("sign first", { status: 403 }) as any);

    expect((await action(args("POST", { content: "x" }))).status).toBe(403);
    expect(db.interviewNoteVersion.create).not.toHaveBeenCalled();
  });

  it.each([
    ["missing content", {}],
    ["non-string content", { content: 5 }],
    ["content over 100,000 characters", { content: "x".repeat(100_001) }],
  ])("rejects %s with 400", async (_l, body) => {
    expect((await action(args("POST", body))).status).toBe(400);
    expect(db.interviewNoteVersion.create).not.toHaveBeenCalled();
  });

  it("accepts content at exactly 100,000 characters", async () => {
    expect((await action(args("POST", { content: "x".repeat(100_000) }))).status).toBe(201);
  });

  it("returns the auth failure", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as any);

    expect((await action(args("POST", { content: "x" }))).status).toBe(401);
  });
});
