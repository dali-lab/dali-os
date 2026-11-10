import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/cors", () => ({ handlePreflight: () => null, withCors: (_req: Request, res: Response) => res }));
vi.mock("~/hiring/lib/confidentiality", () => ({ requireApiSignedOrForbidden: vi.fn().mockResolvedValue(null) }));
vi.mock("~/hiring/lib/email-engagement.server", () => ({ getEngagementSummaries: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { getEngagementSummaries } from "~/hiring/lib/email-engagement.server";
import { loader } from "~/hiring/routes/api.cycles.$cycleId.my-interviews";

const mockPrisma = prisma as unknown as Record<string, any>;

const callLoader = () =>
  loader({
    request: new Request("http://localhost/api/hiring/cycles/c1/my-interviews"),
    params: { cycleId: "c1" },
    context: {},
  } as any) as Promise<Response>;

const assignment = (id: string, userId: string) => ({
  id,
  interview: { id: `i-${id}`, domainApplication: { application: { userId, user: { firstName: "A", lastName: "B" } } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "me" } } as any);
  mockPrisma.dALIMember = { findUnique: vi.fn().mockResolvedValue({ userId: "me" }) };
  mockPrisma.cycleInterviewer = { findMany: vi.fn().mockResolvedValue([{ id: "ci1" }]) };
  mockPrisma.interviewAssignment = { findMany: vi.fn().mockResolvedValue([]) };
  vi.mocked(getEngagementSummaries).mockResolvedValue(new Map());
});

describe("GET my-interviews", () => {
  it("adds each applicant's email engagement to their assignment, null when they never wrote", async () => {
    mockPrisma.interviewAssignment.findMany.mockResolvedValue([assignment("a1", "wrote"), assignment("a2", "silent")]);
    const summary = { fromThem: 3, threadsStarted: 0, lastFromThemAt: "2026-01-01T00:00:00.000Z" };
    vi.mocked(getEngagementSummaries).mockResolvedValue(new Map([["wrote", summary]]));

    const body = await (await callLoader()).json();

    expect(getEngagementSummaries).toHaveBeenCalledWith(["wrote", "silent"]);
    expect(body.map((a: any) => [a.id, a.emailEngagement])).toEqual([
      ["a1", summary],
      ["a2", null],
    ]);
    expect(body[0].interview.id).toBe("i-a1");
  });

  it("returns an empty list without looking up engagement when the user interviews on nothing", async () => {
    mockPrisma.cycleInterviewer.findMany.mockResolvedValue([]);
    const body = await (await callLoader()).json();
    expect(body).toEqual([]);
    expect(getEngagementSummaries).not.toHaveBeenCalled();
  });
});
