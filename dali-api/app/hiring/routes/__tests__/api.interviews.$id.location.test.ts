import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ hasCycleAccess: vi.fn() }));
vi.mock("~/hiring/lib/interview-meet", () => ({
  provisionInterviewMeet: vi.fn().mockResolvedValue(undefined),
  deprovisionInterviewMeet: vi.fn().mockResolvedValue(undefined),
  ensureInterviewMeetUrl: vi.fn().mockResolvedValue("https://meet.example.edu/abc"),
}));
vi.mock("~/hiring/lib/interview-emails", () => ({
  sendLocationChangeEmails: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/rooms.server", () => ({ createRoomBooking: vi.fn() }));
vi.mock("~/hiring/lib/scheduling", () => ({
  releaseInterviewRoom: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { hasCycleAccess } from "~/lib/roles";
import {
  provisionInterviewMeet,
  deprovisionInterviewMeet,
} from "~/hiring/lib/interview-meet";
import { sendLocationChangeEmails } from "~/hiring/lib/interview-emails";
import { createRoomBooking } from "~/lib/rooms.server";
import { releaseInterviewRoom } from "~/hiring/lib/scheduling";
import { action } from "~/hiring/routes/api.interviews.$id.location";

const m = prisma as any;

const INTERVIEW = {
  id: "int1",
  applicationCycleId: "cycle1",
  domainApplicationId: "da1",
  status: "Scheduled",
  startTime: new Date("2026-11-10T15:00:00Z"),
  endTime: new Date("2026-11-10T15:30:00Z"),
  calendarEventId: "cal1",
  roomBookingId: "rb-old",
  roomBooking: { userId: "u-old" },
};

const patch = (body: unknown, method = "PATCH") =>
  action({
    request: new Request("http://localhost/api/interviews/int1/location", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    }),
    params: { id: "int1" },
    context: {},
  } as any) as Promise<Response>;

let tx: any;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "lead" } } as any);
  vi.mocked(hasCycleAccess).mockResolvedValue(true);
  tx = {
    room: { findUnique: vi.fn().mockResolvedValue({ id: "room1", archivedAt: null }) },
    interviewConfig: { findFirst: vi.fn().mockResolvedValue({ id: "cfg" }) },
    interviewAssignment: {
      findFirst: vi.fn().mockResolvedValue({ cycleInterviewer: { userId: "u-interviewer" } }),
    },
    interview: { update: vi.fn().mockResolvedValue({ id: "int1" }) },
  };
  m.interview = {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce(INTERVIEW)
      .mockResolvedValue({ id: "int1", roomId: "room1", videoUrl: null }),
  };
  m.$transaction = vi.fn(async (fn: any) => fn(tx));
  vi.mocked(createRoomBooking).mockResolvedValue({ ok: true, value: { id: "rb-new" } } as any);
});

describe("access", () => {
  it("returns the auth response when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as any);
    expect((await patch({ roomId: null })).status).toBe(401);
    expect(m.interview.findUnique).not.toHaveBeenCalled();
  });

  it("rejects non-PATCH methods with 405", async () => {
    expect((await patch({}, "POST")).status).toBe(405);
  });

  it("rejects a body without roomId", async () => {
    expect((await patch({})).status).toBe(400);
  });

  it("returns 404 for an unknown interview", async () => {
    m.interview.findUnique.mockReset().mockResolvedValue(null);
    expect((await patch({ roomId: null })).status).toBe(404);
  });

  it("requires access to the interview's cycle and changes nothing without it", async () => {
    vi.mocked(hasCycleAccess).mockResolvedValue(false);
    const res = await patch({ roomId: "room1" });
    expect(res.status).toBe(403);
    expect(hasCycleAccess).toHaveBeenCalledWith("lead", "cycle1");
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("only allows changing Scheduled interviews", async () => {
    m.interview.findUnique.mockReset().mockResolvedValue({ ...INTERVIEW, status: "Completed" });
    const res = await patch({ roomId: "room1" });
    expect(res.status).toBe(400);
    expect(m.$transaction).not.toHaveBeenCalled();
  });
});

describe("moving to a room", () => {
  it("releases the old booking, books the room for the in-domain interviewer, and stores both ids", async () => {
    const res = await patch({ roomId: "room1" });
    expect(res.status).toBe(200);
    expect(m.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(releaseInterviewRoom).toHaveBeenCalledWith(INTERVIEW, tx);
    expect(tx.interviewAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { interviewId: "int1", role: "InDomain", status: "Active" },
      }),
    );
    expect(createRoomBooking).toHaveBeenCalledWith(
      {
        roomId: "room1",
        userId: "u-interviewer",
        start: INTERVIEW.startTime,
        end: INTERVIEW.endTime,
        title: "Interview",
        source: "Interview",
        applicationCycleId: "cycle1",
      },
      tx,
    );
    expect(tx.interview.update).toHaveBeenCalledWith({
      where: { id: "int1" },
      data: { roomId: "room1", roomBookingId: "rb-new" },
    });
    expect(deprovisionInterviewMeet).toHaveBeenCalledWith({ id: "int1", calendarEventId: "cal1" });
    expect(provisionInterviewMeet).not.toHaveBeenCalled();
    expect(sendLocationChangeEmails).toHaveBeenCalledWith("int1", "da1");
  });

  it("404s for a missing or archived room", async () => {
    tx.room.findUnique.mockResolvedValue({ id: "room1", archivedAt: new Date() });
    const res = await patch({ roomId: "room1" });
    expect(res.status).toBe(404);
    expect(tx.interview.update).not.toHaveBeenCalled();
    expect(releaseInterviewRoom).not.toHaveBeenCalled();
  });

  it("rejects a room that is not configured for this cycle", async () => {
    tx.interviewConfig.findFirst.mockResolvedValue(null);
    const res = await patch({ roomId: "room1" });
    expect(res.status).toBe(400);
    expect(tx.interviewConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { applicationCycleId: "cycle1", rooms: { some: { id: "room1" } } },
      }),
    );
    expect(tx.interview.update).not.toHaveBeenCalled();
  });

  it("rejects when there is no active in-domain interviewer to book under", async () => {
    tx.interviewAssignment.findFirst.mockResolvedValue(null);
    const res = await patch({ roomId: "room1" });
    expect(res.status).toBe(400);
    expect(createRoomBooking).not.toHaveBeenCalled();
    expect(tx.interview.update).not.toHaveBeenCalled();
  });

  it("surfaces a room booking conflict with its status and message", async () => {
    vi.mocked(createRoomBooking).mockResolvedValue({
      ok: false,
      error: "Room is already booked",
      status: 409,
    } as any);
    const res = await patch({ roomId: "room1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Room is already booked" });
    expect(tx.interview.update).not.toHaveBeenCalled();
    expect(sendLocationChangeEmails).not.toHaveBeenCalled();
  });

  it("rethrows unexpected errors", async () => {
    m.$transaction.mockRejectedValue(new Error("db down"));
    await expect(patch({ roomId: "room1" })).rejects.toThrow("db down");
  });
});

describe("moving to remote (roomId null)", () => {
  it("clears the room and booking, skips room validation and booking, and provisions Meet", async () => {
    const res = await patch({ roomId: null });
    expect(res.status).toBe(200);
    expect(tx.room.findUnique).not.toHaveBeenCalled();
    expect(createRoomBooking).not.toHaveBeenCalled();
    expect(releaseInterviewRoom).toHaveBeenCalledWith(INTERVIEW, tx);
    expect(tx.interview.update).toHaveBeenCalledWith({
      where: { id: "int1" },
      data: { roomId: null, roomBookingId: null },
    });
    expect(provisionInterviewMeet).toHaveBeenCalledWith("int1");
    expect(deprovisionInterviewMeet).not.toHaveBeenCalled();
  });

  it("fills the response videoUrl with the ensured Meet link when no room remains", async () => {
    m.interview.findUnique
      .mockReset()
      .mockResolvedValueOnce(INTERVIEW)
      .mockResolvedValue({ id: "int1", roomId: null, videoUrl: null });
    const res = await patch({ roomId: null });
    expect((await res.json()).videoUrl).toBe("https://meet.example.edu/abc");
  });
});
