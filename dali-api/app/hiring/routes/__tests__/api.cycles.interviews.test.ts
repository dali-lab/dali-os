import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ hasCycleAccess: vi.fn().mockResolvedValue(true) }));
vi.mock("~/lib/cors", () => ({ handlePreflight: () => null, withCors: (_req: Request, res: Response) => res }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null) }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { loader } from "~/hiring/routes/api.cycles.$cycleId.interviews";

const mockPrisma = prisma as unknown as Record<string, any>;

const get = (round?: string) =>
  loader({
    request: new Request(`http://localhost/api/hiring/cycles/c1/interviews${round ? `?round=${round}` : ""}`),
    params: { cycleId: "c1" },
    context: {},
  } as any).then((r: Response) => r.json());

const candidate = (id: string, latest: { type: string; interviewRoundId: string | null }, completed = 0) => ({
  id,
  domain: { name: "Design" },
  application: { user: { id: `u-${id}`, firstName: "A", lastName: "B" } },
  decisions: [{ id: `d-${id}`, createdAt: new Date("2026-10-10"), ...latest }],
  interviews: Array.from({ length: completed }, (_, i) => ({ id: `i-${id}-${i}` })),
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
      candidate("done", { type: "InvitedToInterview", interviewRoundId: "iv2" }, 1),
      candidate("moved-on", { type: "InvitedToInterview", interviewRoundId: "iv3" }),
      candidate("rejected", { type: "Rejected", interviewRoundId: null }),
    ]);
    const { pending } = await get("iv2");
    expect(pending.map((p: { id: string }) => p.id)).toEqual(["waiting"]);
  });
});
