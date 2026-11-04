import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireMemberSession } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { requireApiSignedOrForbidden } from "~/hiring/lib/confidentiality";
import { action } from "~/hiring/routes/api.interviews.$id.complete";

const db = prisma as any;

const call = (method: string, body?: unknown) =>
  action({
    request: new Request("http://localhost/api/hiring/interviews/iv1/complete", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    params: { id: "iv1" },
    context: {},
  } as any);

const interview = (status = "Scheduled") => ({
  id: "iv1",
  status,
  applicationCycleId: "c1",
  domainApplicationId: "da1",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "ada" } } } as any);
  vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(null as any);
  vi.mocked(isCore).mockResolvedValue(true);
  db.interviewAssignment = { findFirst: vi.fn().mockResolvedValue({ id: "asg1" }) };
  db.interview = {
    findUnique: vi.fn().mockResolvedValue(interview()),
    update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "iv1", ...data })),
  };
});

describe("access", () => {
  it("returns the member-gate failure", async () => {
    vi.mocked(requireMemberSession).mockResolvedValue({ ok: false, response: new Response("no", { status: 403 }) } as any);

    expect((await call("POST", { recommendation: "Hire" })).status).toBe(403);
    expect(db.interviewAssignment.findFirst).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT"])("rejects %s", async (method) => {
    expect((await call(method)).status).toBe(405);
  });

  it("only lets an active interviewer on this interview act", async () => {
    db.interviewAssignment.findFirst.mockResolvedValue(null);

    const res = await call("POST", { recommendation: "Hire" });

    expect(res.status).toBe(403);
    expect(db.interviewAssignment.findFirst).toHaveBeenCalledWith({
      where: { interviewId: "iv1", status: "Active", cycleInterviewer: { userId: "ada" } },
    });
    expect(db.interview.update).not.toHaveBeenCalled();
  });

  it("404s a missing interview", async () => {
    db.interview.findUnique.mockResolvedValue(null);

    expect((await call("POST", { recommendation: "Hire" })).status).toBe(404);
  });

  it("is blocked until the confidentiality agreement for the interview's cycle is signed", async () => {
    vi.mocked(requireApiSignedOrForbidden).mockResolvedValue(new Response("sign first", { status: 403 }) as any);

    expect((await call("POST", { recommendation: "Hire" })).status).toBe(403);
    expect(requireApiSignedOrForbidden).toHaveBeenCalledWith("ada", "c1");
    expect(db.interview.update).not.toHaveBeenCalled();
  });
});

describe("POST complete", () => {
  it("marks the interview Completed with the joint recommendation and notes", async () => {
    const res = await call("POST", { recommendation: "Lean Hire", recommendationNotes: "Good fit" });

    expect(res.status).toBe(200);
    expect(db.interview.update).toHaveBeenCalledWith({
      where: { id: "iv1" },
      data: { status: "Completed", recommendation: "Lean Hire", recommendationNotes: "Good fit" },
    });
  });

  it("stores null notes when none are given", async () => {
    await call("POST", { recommendation: "Hire" });

    expect(db.interview.update.mock.calls[0][0].data.recommendationNotes).toBeNull();
  });

  it("audits the first transition into Completed", async () => {
    await call("POST", { recommendation: "Hire" });

    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({
      action: "interview.complete",
      userId: "ada",
      targetId: "iv1",
      metadata: { cycleId: "c1", domainApplicationId: "da1", recommendation: "Hire" },
    });
  });

  it("lets the co-interviewer re-submit an already completed interview without a second audit event", async () => {
    db.interview.findUnique.mockResolvedValue(interview("Completed"));

    const res = await call("POST", { recommendation: "No Hire" });

    expect(res.status).toBe(200);
    expect(db.interview.update.mock.calls[0][0].data).toMatchObject({ status: "Completed", recommendation: "No Hire" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown recommendation", { recommendation: "Maybe" }],
    ["no recommendation", {}],
    ["notes over 10,000 characters", { recommendation: "Hire", recommendationNotes: "x".repeat(10_001) }],
  ])("rejects %s with 400", async (_l, body) => {
    expect((await call("POST", body)).status).toBe(400);
    expect(db.interview.update).not.toHaveBeenCalled();
  });

  it.each(["Strong Hire", "Hire", "Lean Hire", "Lean No Hire", "No Hire"])("accepts %s", async (recommendation) => {
    expect((await call("POST", { recommendation })).status).toBe(200);
  });

  it("lets a non-Core interviewer complete", async () => {
    vi.mocked(isCore).mockResolvedValue(false);

    expect((await call("POST", { recommendation: "Hire" })).status).toBe(200);
  });
});

describe("DELETE complete (reopen)", () => {
  it("lets Core flip a completed interview back to Scheduled, keeping the recommendation, and audits it", async () => {
    db.interview.findUnique.mockResolvedValue(interview("Completed"));

    const res = await call("DELETE");

    expect(res.status).toBe(200);
    expect(db.interview.update).toHaveBeenCalledWith({ where: { id: "iv1" }, data: { status: "Scheduled" } });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({
      action: "interview.reopen",
      userId: "ada",
      targetId: "iv1",
      metadata: { cycleId: "c1", domainApplicationId: "da1" },
    });
  });

  it("is Core only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    db.interview.findUnique.mockResolvedValue(interview("Completed"));

    const res = await call("DELETE");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only hiring leads can reopen interviews" });
    expect(db.interview.update).not.toHaveBeenCalled();
  });

  it("409s an interview that is not completed", async () => {
    expect((await call("DELETE")).status).toBe(409);
    expect(db.interview.update).not.toHaveBeenCalled();
  });
});
