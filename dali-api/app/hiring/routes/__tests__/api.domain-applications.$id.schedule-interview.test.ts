import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/scheduling", () => ({ assignInterviewers: vi.fn() }));
vi.mock("~/hiring/lib/interview-meet", () => ({ provisionInterviewMeet: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-emails", () => ({ sendInterviewInviteEmails: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-notifications", () => ({ notifyInterviewAssigned: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/hiring/lib/interview-rounds.server", () => ({ invitedRoundId: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { assignInterviewers } from "~/hiring/lib/scheduling";
import { provisionInterviewMeet } from "~/hiring/lib/interview-meet";
import { sendInterviewInviteEmails } from "~/hiring/lib/interview-emails";
import { notifyInterviewAssigned } from "~/hiring/lib/interview-notifications";
import { invitedRoundId } from "~/hiring/lib/interview-rounds.server";
import { action } from "~/hiring/routes/api.domain-applications.$id.schedule-interview";

const db = prisma as any;

const NOW = new Date("2026-11-03T12:00:00Z");
const SLOT = "2026-11-10T15:00:00Z";

const call = (body: unknown = { startTime: SLOT }, method = "POST") =>
  action({
    request: new Request("http://localhost/api/hiring/domain-applications/da1/schedule-interview", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    }),
    params: { id: "da1" },
    context: {},
  } as any);

const da = (over: Record<string, unknown> = {}) => ({
  id: "da1",
  domainId: "dom1",
  application: { userId: "applicant", applicationCycleId: "c1" },
  interviews: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "applicant" } } as any);
  vi.mocked(invitedRoundId).mockResolvedValue("interviews");
  vi.mocked(assignInterviewers).mockResolvedValue({ id: "iv1", assignments: [{ id: "a1" }, { id: "a2" }] } as any);
  db.domainApplication = { findUnique: vi.fn().mockResolvedValue(da()) };
  db.interviewConfig = {
    findUnique: vi.fn().mockResolvedValue({ slotDurationMinutes: 30, bookingNoticeHours: 24 }),
  };
});
afterEach(() => vi.useRealTimers());

describe("POST schedule-interview", () => {
  it("returns the auth failure untouched", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as any);

    expect((await call()).status).toBe(401);
    expect(db.domainApplication.findUnique).not.toHaveBeenCalled();
  });

  it("rejects non-POST methods", async () => {
    expect((await call({}, "GET")).status).toBe(405);
  });

  it.each([
    ["a missing start time", {}],
    ["a start time without a UTC offset", { startTime: "2026-11-10T15:00:00" }],
    ["an unknown mode", { startTime: SLOT, mode: "telepathy" }],
  ])("rejects %s before touching the database", async (_l, body) => {
    expect((await call(body)).status).toBe(400);
    expect(db.domainApplication.findUnique).not.toHaveBeenCalled();
  });

  it("404s an unknown domain application", async () => {
    db.domainApplication.findUnique.mockResolvedValue(null);

    expect((await call()).status).toBe(404);
  });

  it("only lets the applicant book their own interview", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "someone-else" } } as any);

    const res = await call();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not your application" });
    expect(assignInterviewers).not.toHaveBeenCalled();
  });

  it("refuses an applicant who has not been invited to interview", async () => {
    vi.mocked(invitedRoundId).mockResolvedValue(null as any);

    const res = await call();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not invited to interview" });
    expect(db.interviewConfig.findUnique).not.toHaveBeenCalled();
  });

  it("409s when an interview is already scheduled, even for another round", async () => {
    db.domainApplication.findUnique.mockResolvedValue(
      da({ interviews: [{ status: "Scheduled", interviewRoundId: "other-round" }] }),
    );

    expect((await call()).status).toBe(409);
    expect(assignInterviewers).not.toHaveBeenCalled();
  });

  it("409s when this round was already completed", async () => {
    db.domainApplication.findUnique.mockResolvedValue(
      da({ interviews: [{ status: "Completed", interviewRoundId: "interviews" }] }),
    );

    expect((await call()).status).toBe(409);
  });

  it("allows booking a later round after an earlier round completed", async () => {
    db.domainApplication.findUnique.mockResolvedValue(
      da({ interviews: [{ status: "Completed", interviewRoundId: "first-round" }] }),
    );

    expect((await call()).status).toBe(201);
  });

  it("400s a domain application with no domain", async () => {
    db.domainApplication.findUnique.mockResolvedValue(da({ domainId: null }));

    expect((await call()).status).toBe(400);
  });

  it("400s when the round has no interview config", async () => {
    db.interviewConfig.findUnique.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No interview config for this round" });
  });

  it("looks up the config by cycle and the invited round", async () => {
    await call();

    expect(db.interviewConfig.findUnique).toHaveBeenCalledWith({
      where: { applicationCycleId_interviewRoundId: { applicationCycleId: "c1", interviewRoundId: "interviews" } },
    });
  });

  it("rejects a slot inside the booking notice window and allows one exactly at its edge", async () => {
    const tooSoon = new Date(NOW.getTime() + 24 * 3600_000 - 1000).toISOString();
    const res = await call({ startTime: tooSoon });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Interviews must be booked at least 24 hours in advance" });

    const edge = new Date(NOW.getTime() + 24 * 3600_000).toISOString();
    expect((await call({ startTime: edge })).status).toBe(201);
  });

  it("books the slot for the configured duration, online by default, and returns 201 with the interview", async () => {
    const res = await call();

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: "iv1" });
    expect(assignInterviewers).toHaveBeenCalledWith(
      "c1",
      "interviews",
      "da1",
      ["dom1"],
      new Date(SLOT),
      new Date("2026-11-10T15:30:00Z"),
      undefined,
      "online",
    );
  });

  it("books in person when asked", async () => {
    await call({ startTime: SLOT, mode: "in-person" });

    expect(vi.mocked(assignInterviewers).mock.calls[0][7]).toBe("in-person");
  });

  it("mints the Meet link, audits, then sends invites and assignment notifications", async () => {
    await call({ startTime: SLOT, mode: "in-person" });

    expect(provisionInterviewMeet).toHaveBeenCalledWith("iv1");
    expect(vi.mocked(logAuditEvent).mock.calls[0][0]).toMatchObject({
      action: "interview.schedule",
      userId: "applicant",
      targetId: "iv1",
      metadata: {
        cycleId: "c1",
        domainApplicationId: "da1",
        startTime: new Date(SLOT).toISOString(),
        mode: "in-person",
        interviewRoundId: "interviews",
      },
    });
    expect(sendInterviewInviteEmails).toHaveBeenCalledWith("iv1", "da1");
    expect(notifyInterviewAssigned).toHaveBeenCalledWith({ assignmentIds: ["a1", "a2"] });
  });

  it("still books when invite emails and notifications fail", async () => {
    vi.mocked(sendInterviewInviteEmails).mockRejectedValue(new Error("smtp"));
    vi.mocked(notifyInterviewAssigned).mockRejectedValue(new Error("down"));

    expect((await call()).status).toBe(201);
  });

  it("409s a race lost to the unique index", async () => {
    vi.mocked(assignInterviewers).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));

    const res = await call();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Interview already scheduled" });
    expect(sendInterviewInviteEmails).not.toHaveBeenCalled();
  });

  it("409s with the reason when no interviewer is free", async () => {
    vi.mocked(assignInterviewers).mockRejectedValue(new Error("No interviewers available"));

    const res = await call();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "No interviewers available" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
