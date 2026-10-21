import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/hiring/lib/cycles", () => ({ getOpenCycles: vi.fn() }));
vi.mock("~/hiring/lib/applicant-groups.server", () => ({
  applicantGroup: vi.fn((applicants: string, cycleId: string) => ({
    eligible: vi.fn().mockResolvedValue(applicants === "Interns"),
    portalPath: `/fellowship/${cycleId}`,
  })),
}));

import { prisma } from "~/lib/db";
import { getOpenCycles } from "~/hiring/lib/cycles";
import { getInternalCycleApplyTasks } from "~/lib/tasks";

const mockPrisma = prisma as unknown as Record<string, any>;
const mockGetOpenCycles = getOpenCycles as unknown as ReturnType<typeof vi.fn>;

const CYCLE_CLOSE = new Date("2026-10-21T03:59:59.000Z");
const LATE_CLOSE = new Date("2026-10-26T03:59:59.000Z");

function internCycle(domains: { domainId: string; closeDate: Date | null }[]) {
  return { id: "c1", name: "Fall Fellowship", applicants: "Interns", closeDate: CYCLE_CLOSE, domains };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date("2026-10-21T14:00:00.000Z"), toFake: ["Date"] });
  mockPrisma.application = { findFirst: vi.fn().mockResolvedValue(null) };
  mockGetOpenCycles.mockImplementation(({ applicants }: { applicants: string }) =>
    Promise.resolve(
      applicants === "Interns"
        ? [internCycle([{ domainId: "web", closeDate: null }, { domainId: "engs", closeDate: LATE_CLOSE }])]
        : [],
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getInternalCycleApplyTasks dueAt", () => {
  it("is the latest open domain's close for someone who hasn't started, not the cycle's lapsed close", async () => {
    const [task] = await getInternalCycleApplyTasks("u1");
    expect(task.dueAt).toBe(LATE_CLOSE.toISOString());
  });

  it("is the open domain's close for a draft whose picked domain has closed", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      statusUpdates: [{ newStatus: "Draft", createdAt: new Date("2026-10-15") }],
      domainApplications: [{ domainId: "web" }],
    });
    const [task] = await getInternalCycleApplyTasks("u1");
    expect(task.dueAt).toBe(LATE_CLOSE.toISOString());
  });

  it("is the cycle's own close for a cycle with no ready domains", async () => {
    mockGetOpenCycles.mockImplementation(({ applicants }: { applicants: string }) =>
      Promise.resolve(applicants === "Interns" ? [{ ...internCycle([]), closeDate: LATE_CLOSE }] : []),
    );
    const [task] = await getInternalCycleApplyTasks("u1");
    expect(task.dueAt).toBe(LATE_CLOSE.toISOString());
  });

  it("drops the task once the application is submitted", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      statusUpdates: [{ newStatus: "Submitted", createdAt: new Date("2026-10-15") }],
      domainApplications: [{ domainId: "engs" }],
    });
    expect(await getInternalCycleApplyTasks("u1")).toEqual([]);
  });
});
