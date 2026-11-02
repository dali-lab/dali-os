import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ hasCycleAccess: vi.fn().mockResolvedValue(true) }));
vi.mock("~/lib/cors", () => ({ handlePreflight: () => null, withCors: (_req: Request, res: Response) => res }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null) }));
vi.mock("~/hiring/lib/scheduling", () => ({ freeUserIdsByInterview: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { freeUserIdsByInterview } from "~/hiring/lib/scheduling";
import { loader } from "~/hiring/routes/api.cycles.$cycleId.interviews";

const mockPrisma = prisma as unknown as Record<string, any>;

const get = (round?: string) =>
  loader({
    request: new Request(`http://localhost/api/hiring/cycles/c1/interviews${round ? `?round=${round}` : ""}`),
    params: { cycleId: "c1" },
    context: {},
  } as any).then((r: Response) => r.json());

const candidate = (
  id: string,
  latest: { type: string; interviewRoundId: string | null },
  interviews: { status: string; interviewRoundId: string }[] = [],
) => ({
  id,
  domain: { name: "Design" },
  application: { user: { id: `u-${id}`, firstName: "A", lastName: "B" } },
  decisions: [{ id: `d-${id}`, createdAt: new Date("2026-10-10"), ...latest }],
  interviews,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "me" } } as any);
  mockPrisma.interview = { findMany: vi.fn().mockResolvedValue([]) };
  mockPrisma.domainApplication = { findMany: vi.fn().mockResolvedValue([]) };
});

describe("GET cycle interviews", () => {
  it("lists the first round's interviews and invites when no round is named", async () => {
    await get();
    expect(mockPrisma.interview.findMany.mock.calls[0][0].where).toEqual({
      applicationCycleId: "c1",
      interviewRoundId: "interviews",
    });
    expect(mockPrisma.domainApplication.findMany.mock.calls[0][0].where.decisions).toEqual({
      some: { type: "InvitedToInterview", stage: "Released", interviewRoundId: "interviews" },
    });
  });

  it("keeps only applicants whose latest release is this round's invite and who haven't interviewed in it", async () => {
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      candidate("waiting", { type: "InvitedToInterview", interviewRoundId: "iv2" }),
      candidate("done", { type: "InvitedToInterview", interviewRoundId: "iv2" }, [
        { status: "Completed", interviewRoundId: "iv2" },
      ]),
      candidate("moved-on", { type: "InvitedToInterview", interviewRoundId: "iv3" }),
      candidate("rejected", { type: "Rejected", interviewRoundId: null }),
    ]);
    const { pending } = await get("iv2");
    expect(pending.map((p: { id: string }) => p.id)).toEqual(["waiting"]);
  });

  it("flags an applicant who cancelled their own interview as withdrawn, not awaiting schedule", async () => {
    mockPrisma.domainApplication.findMany.mockResolvedValue([
      candidate("waiting", { type: "InvitedToInterview", interviewRoundId: "iv2" }),
      candidate("cancelled", { type: "InvitedToInterview", interviewRoundId: "iv2" }, [
        { status: "CancelledByApplicant", interviewRoundId: "iv2" },
      ]),
    ]);
    const { pending } = await get("iv2");
    expect(pending.map((p: { id: string; withdrawn: boolean }) => [p.id, p.withdrawn])).toEqual([
      ["waiting", false],
      ["cancelled", true],
    ]);
  });

  it("leaves out applicants who withdrew their whole application", async () => {
    await get();
    expect(mockPrisma.domainApplication.findMany.mock.calls[0][0].where.application.statusUpdates).toEqual({
      none: { newStatus: "Withdrawn" },
    });
  });

  it("reports who is free only for upcoming scheduled interviews", async () => {
    const future = new Date(Date.now() + 60 * 60_000);
    const past = new Date(Date.now() - 60 * 60_000);
    const upcoming = { id: "upcoming", status: "Scheduled", startTime: future };
    mockPrisma.interview.findMany.mockResolvedValue([
      upcoming,
      { id: "cancelled", status: "CancelledByApplicant", startTime: future },
      { id: "past", status: "Scheduled", startTime: past },
    ]);
    vi.mocked(freeUserIdsByInterview).mockResolvedValue(new Map([["upcoming", ["u1"]]]));

    const { interviews } = await get("iv2");

    expect(vi.mocked(freeUserIdsByInterview).mock.calls[0][0]).toBe("c1");
    expect(vi.mocked(freeUserIdsByInterview).mock.calls[0][1]).toBe("iv2");
    expect(vi.mocked(freeUserIdsByInterview).mock.calls[0][2].map((i) => i.id)).toEqual(["upcoming"]);
    expect(interviews.map((i: { id: string; freeUserIds: string[] }) => [i.id, i.freeUserIds])).toEqual([
      ["upcoming", ["u1"]],
      ["cancelled", []],
      ["past", []],
    ]);
  });

  it("doesn't read calendars when nothing can be reassigned", async () => {
    await get();
    expect(freeUserIdsByInterview).not.toHaveBeenCalled();
  });
});
