import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    scheduledMeeting: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    meetingTimeProposal: { create: vi.fn() },
  },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(async () => false),
  forbidden: () => new Response("forbidden", { status: 403 }),
}));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handlePreflight: vi.fn(() => null),
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth, isNonMember } from "~/lib/auth";
import { handlePreflight } from "~/lib/cors";
import { notify } from "~/lib/notify.server";
import { action } from "../api.scheduled-meetings.$id.propose-time";

const findMeeting = vi.mocked(prisma.scheduledMeeting.findUnique);
const findUser = vi.mocked(prisma.user.findUnique);
const createProposal = vi.mocked(prisma.meetingTimeProposal.create);

const PROPOSED = "2026-11-12T18:30:00.000Z";

function post(body: unknown, method = "POST") {
  return action({
    request: new Request("http://os.test/api/scheduled-meetings/m1/propose-time", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    params: { id: "m1" },
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(handlePreflight).mockReturnValue(null);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u2" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  findMeeting.mockResolvedValue({
    id: "m1",
    organizerId: "org-1",
    participantUserIds: ["u2", "u3"],
    title: "Planning",
    status: "Confirmed",
  } as never);
  findUser.mockResolvedValue({ firstName: "Ada", lastName: "Lovelace" } as never);
});

describe("POST /api/scheduled-meetings/:id/propose-time", () => {
  it("records a pending proposal for an invited attendee and tells the organizer", async () => {
    const res = await post({ proposedStart: PROPOSED });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createProposal).toHaveBeenCalledWith({
      data: {
        scheduledMeetingId: "m1",
        proposedByUserId: "u2",
        proposedStart: new Date(PROPOSED),
        status: "Pending",
      },
    });
    expect(notify).toHaveBeenCalledWith({
      eventType: "meeting.time_proposed",
      createdByUserId: "u2",
      message: {
        vars: { personName: "Ada Lovelace", itemTitle: "Planning" },
        link: "/calendar/meeting/m1",
        scheduledMeetingId: "m1",
      },
      recipients: [{ userId: "org-1" }],
    });
  });

  it("falls back to 'Someone' when the proposer has no profile row", async () => {
    findUser.mockResolvedValue(null);

    await post({ proposedStart: PROPOSED });

    expect(vi.mocked(notify).mock.calls[0]![0].message.vars).toMatchObject({ personName: "Someone" });
  });

  it("404s a missing meeting", async () => {
    findMeeting.mockResolvedValue(null);

    expect((await post({ proposedStart: PROPOSED })).status).toBe(404);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("refuses a cancelled meeting", async () => {
    findMeeting.mockResolvedValue({ id: "m1", organizerId: "org-1", participantUserIds: ["u2"], title: "x", status: "Cancelled" } as never);

    const res = await post({ proposedStart: PROPOSED });

    expect(res.status).toBe(400);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("refuses the organizer, who should just edit the meeting", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "org-1" } } as never);

    const res = await post({ proposedStart: PROPOSED });

    expect(res.status).toBe(400);
    expect(createProposal).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses someone who is not invited", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "stranger" } } as never);

    const res = await post({ proposedStart: PROPOSED });

    expect(res.status).toBe(403);
    expect(createProposal).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects a malformed proposed start before reading the meeting", async () => {
    expect((await post({ proposedStart: "next tuesday" })).status).toBe(400);
    expect(findMeeting).not.toHaveBeenCalled();
  });

  it("refuses a non-member", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);

    expect((await post({ proposedStart: PROPOSED })).status).toBe(403);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);

    expect((await post({ proposedStart: PROPOSED })).status).toBe(401);
  });

  it("405s anything but POST", async () => {
    expect((await post(null, "GET")).status).toBe(405);
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("returns the preflight response first", async () => {
    vi.mocked(handlePreflight).mockReturnValue(new Response(null, { status: 204 }));

    expect((await post({ proposedStart: PROPOSED })).status).toBe(204);
    expect(requireAuth).not.toHaveBeenCalled();
  });
});
