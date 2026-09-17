import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
}));
vi.mock("~/lib/db", () => ({
  prisma: {
    meetingTimeProposal: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    scheduledMeeting: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: vi.fn((_req: Request, res: Response) => res),
  handlePreflight: vi.fn(() => null),
}));
vi.mock("~/lib/validate", () => ({ parseJson: vi.fn() }));
vi.mock("~/lib/scheduled-meeting", () => ({
  updateScheduledMeeting: vi.fn(),
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { updateScheduledMeeting } from "~/lib/scheduled-meeting";
import { action } from "~/calendar/routes/api.scheduled-meetings.$id.proposal";

const m = {
  proposal: prisma.meetingTimeProposal.findUnique as unknown as ReturnType<typeof vi.fn>,
  proposalUpdate: prisma.meetingTimeProposal.update as unknown as ReturnType<typeof vi.fn>,
  proposalUpdateMany: prisma.meetingTimeProposal.updateMany as unknown as ReturnType<typeof vi.fn>,
  meeting: prisma.scheduledMeeting.findUnique as unknown as ReturnType<typeof vi.fn>,
};

const PROPOSED_START = new Date("2026-11-15T14:00:00.000Z");

const fakeMeeting = {
  id: "m1",
  title: "Standup",
  durationMinutes: 30,
  scopeType: "UserList",
  scopeId: null,
  participantUserIds: ["u2"],
  organizerId: "org1",
};

const fakeProposal = {
  id: "p1",
  scheduledMeetingId: "m1",
  proposedByUserId: "u2",
  proposedStart: PROPOSED_START,
  status: "Pending",
};

function makeRequest(body: object) {
  return new Request("http://localhost/api/scheduled-meetings/m1/proposal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "org1", type: "member" } } as never);
  vi.mocked(isCore).mockResolvedValue(false);
  m.proposal.mockResolvedValue(fakeProposal);
  m.meeting.mockResolvedValue(fakeMeeting);
  m.proposalUpdate.mockResolvedValue({});
  m.proposalUpdateMany.mockResolvedValue({});
});

describe("proposal route – decline", () => {
  it("marks proposal Declined and returns ok", async () => {
    vi.mocked(parseJson).mockResolvedValue({ action: "decline", proposalId: "p1" } as never);
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(m.proposalUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "Declined" },
    });
    expect(updateScheduledMeeting).not.toHaveBeenCalled();
  });
});

describe("proposal route – accept", () => {
  beforeEach(() => {
    vi.mocked(parseJson).mockResolvedValue({ action: "accept", proposalId: "p1" } as never);
    vi.mocked(updateScheduledMeeting).mockResolvedValue({
      ok: true,
      meeting: {} as never,
      gcalError: null,
    });
  });

  it("calls updateScheduledMeeting with the proposal's proposedStart as startTime", async () => {
    await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(updateScheduledMeeting).toHaveBeenCalledWith(
      "m1",
      "org1",
      expect.objectContaining({
        startTime: PROPOSED_START.toISOString(),
        editScope: "all",
      }),
    );
  });

  it("marks the accepted proposal Accepted", async () => {
    await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(m.proposalUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "Accepted" },
    });
  });

  it("declines other Pending proposals on the same meeting", async () => {
    await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(m.proposalUpdateMany).toHaveBeenCalledWith({
      where: {
        scheduledMeetingId: "m1",
        status: "Pending",
        id: { not: "p1" },
      },
      data: { status: "Declined" },
    });
  });

  it("returns ok and gcalError", async () => {
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    const body = await res.json();
    expect(body).toEqual({ ok: true, gcalError: null });
  });

  it("returns error when updateScheduledMeeting fails", async () => {
    vi.mocked(updateScheduledMeeting).mockResolvedValue({
      ok: false,
      error: "Conflict",
      status: 409,
    });
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: "Conflict" });
    expect(m.proposalUpdate).not.toHaveBeenCalled();
  });
});

describe("proposal route – guard checks", () => {
  it("404s when proposal not found", async () => {
    vi.mocked(parseJson).mockResolvedValue({ action: "accept", proposalId: "p1" } as never);
    m.proposal.mockResolvedValue(null);
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(res.status).toBe(404);
  });

  it("404s when proposal belongs to a different meeting", async () => {
    vi.mocked(parseJson).mockResolvedValue({ action: "accept", proposalId: "p1" } as never);
    m.proposal.mockResolvedValue({ ...fakeProposal, scheduledMeetingId: "m999" });
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(res.status).toBe(404);
  });

  it("400s when proposal is not Pending", async () => {
    vi.mocked(parseJson).mockResolvedValue({ action: "accept", proposalId: "p1" } as never);
    m.proposal.mockResolvedValue({ ...fakeProposal, status: "Accepted" });
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(res.status).toBe(400);
  });

  it("403s when actor is not organizer and not Core", async () => {
    vi.mocked(parseJson).mockResolvedValue({ action: "decline", proposalId: "p1" } as never);
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u2", type: "member" } } as never);
    // u2 is proposer, not organizer
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    expect(res.status).toBe(403);
  });

  it("allows Core to accept even when not organizer", async () => {
    vi.mocked(parseJson).mockResolvedValue({ action: "decline", proposalId: "p1" } as never);
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core1", type: "member" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
    const res = await action({ request: makeRequest({}), params: { id: "m1" } } as never);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});
