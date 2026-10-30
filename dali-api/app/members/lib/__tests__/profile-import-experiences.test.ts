import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn().mockResolvedValue(null),
  isImpersonating: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  getUserRoles: vi.fn().mockResolvedValue({}),
  isAdmin: vi.fn(),
  isCore: vi.fn(),
}));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db.server";
import { isAdmin } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { runProfileAction } from "~/members/lib/profile-page.server";

const ME = "u-me";

const job = (over: Record<string, string> = {}) => ({
  company: "Acme",
  position: "Engineer",
  description: "",
  location: "",
  workMode: "",
  startMonth: "2020-04",
  endMonth: "",
  ...over,
});

function run(jobs: unknown, { sub = ME, targetId = ME, raw }: { sub?: string; targetId?: string; raw?: string } = {}) {
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub } } as never);
  const body = new FormData();
  body.set("intent", "import-experiences");
  body.set("jobs", raw ?? JSON.stringify(jobs));
  return runProfileAction({
    request: new Request(`http://localhost/members/${targetId}`, { method: "POST", body }),
    targetId,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(false);
  vi.mocked(prisma.workExperience.createMany).mockResolvedValue({ count: 0 } as never);
});

describe("import-experiences", () => {
  it("writes every row with first-of-month UTC dates", async () => {
    const result = await run([job(), job({ company: "Figma", startMonth: "2018-01", endMonth: "2019-06" })]);
    expect(result).toEqual({ imported: 2 });
    expect(prisma.workExperience.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: ME,
          company: "Acme",
          startDate: new Date(Date.UTC(2020, 3, 1)),
          endDate: null,
        }),
        expect.objectContaining({
          userId: ME,
          company: "Figma",
          startDate: new Date(Date.UTC(2018, 0, 1)),
          endDate: new Date(Date.UTC(2019, 5, 1)),
        }),
      ],
    });
  });

  it("writes nothing when one row is bad and names that row", async () => {
    const result = await run([job(), job(), job({ company: "Figma", position: "Designer", startMonth: "" })]);
    expect(result).toEqual({ error: "Row 3 (Designer at Figma): Pick a start month." });
    expect(prisma.workExperience.createMany).not.toHaveBeenCalled();
  });

  it("rejects more than 40 jobs", async () => {
    const result = await run(Array.from({ length: 41 }, () => job()));
    expect(result).toHaveProperty("error");
    expect(prisma.workExperience.createMany).not.toHaveBeenCalled();
  });

  it.each([["an empty array", []], ["a non-array", { company: "x" }]])("rejects %s", async (_n, jobs) => {
    expect(await run(jobs)).toHaveProperty("error");
    expect(prisma.workExperience.createMany).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    expect(await run(null, { raw: "{nope" })).toHaveProperty("error");
    expect(prisma.workExperience.createMany).not.toHaveBeenCalled();
  });

  it("refuses another member importing onto this profile", async () => {
    expect(await run([job()], { sub: "u-other" })).toHaveProperty("error");
    expect(prisma.workExperience.createMany).not.toHaveBeenCalled();
  });

  it("refuses an admin importing onto someone else's profile", async () => {
    vi.mocked(isAdmin).mockResolvedValue(true);
    expect(await run([job()], { sub: "admin-1" })).toHaveProperty("error");
    expect(prisma.workExperience.createMany).not.toHaveBeenCalled();
  });

  it("returns an error with the flag off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect(await run([job()])).toHaveProperty("error");
    expect(prisma.workExperience.createMany).not.toHaveBeenCalled();
  });
});
