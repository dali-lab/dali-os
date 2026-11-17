import { describe, it, expect, vi, beforeEach } from "vitest";

const prisma = vi.hoisted(() => ({
  term: { findMany: vi.fn() },
  staffingPreference: { findMany: vi.fn() },
  staffingAssignment: { findMany: vi.fn() },
  project: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
  projectRoleRequest: { findMany: vi.fn() },
  staffingCardOrder: { findMany: vi.fn() },
  formSubmission: { findMany: vi.fn() },
  staffingBoardMember: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({
  canViewStaffing: vi.fn(),
  canManageStaffing: vi.fn(),
}));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (u: string | null) => u) }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn(async () => "tok") }));
vi.mock("~/lib/presence-user.server", () => ({ getPresenceUser: vi.fn(async () => null) }));
vi.mock("~/components/collab/PresenceProvider", () => ({ PresenceProvider: () => null }));
vi.mock("~/components/collab/PresenceBar", () => ({ PresenceBar: () => null }));
vi.mock("~/components/os-chrome", () => ({ useOsChrome: vi.fn() }));
vi.mock("~/projects/components/StaffingBoard", () => ({ StaffingBoard: () => null }));
vi.mock("~/projects/lib/staffing-cycle", () => ({ ensureStaffingCycle: vi.fn() }));
vi.mock("~/projects/lib/form-slots", () => ({ getSlotBinding: vi.fn() }));
vi.mock("~/projects/lib/submission-view.server", () => ({ buildSubmissionView: vi.fn() }));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canViewStaffing, canManageStaffing } from "~/lib/roles";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import { getSlotBinding } from "~/projects/lib/form-slots";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { loader } from "../core.staffing";

const TERM = {
  id: "t1",
  code: "26F",
  startDate: new Date("2000-01-01"),
  endDate: new Date("2999-01-01"),
  sortKey: 1,
};
const userRow = (id: string, first: string) => ({
  id,
  firstName: first,
  lastName: "Test",
  daliEmail: `${first.toLowerCase()}@example.edu`,
  dartmouthEmail: null,
  photoUrl: null,
  adminMembership: null,
  coreAssignments: [],
  domainEligibilities: [],
});
const project = (id: string, name: string, status = "Active") => ({
  id,
  name,
  status,
  iconEmoji: null,
  githubTeamSlug: null,
  slackChannelName: null,
});
const pref = (userId: string, projectId: string) => ({
  userId,
  projectId,
  domainId: "d1",
  level: "Developer",
  preferenceRank: 1,
  notes: null,
});

const run = (url = "http://localhost/core/staffing") =>
  loader({ request: new Request(url) } as never) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1", email: "ada@example.edu" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canViewStaffing).mockResolvedValue(true);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  vi.mocked(ensureStaffingCycle).mockResolvedValue({ id: "c1" } as never);
  vi.mocked(getSlotBinding).mockResolvedValue(null as never);
  prisma.term.findMany.mockResolvedValue([TERM]);
  prisma.staffingPreference.findMany.mockResolvedValue([]);
  prisma.staffingAssignment.findMany.mockResolvedValue([]);
  prisma.project.findMany.mockResolvedValue([]);
  prisma.domain.findMany.mockResolvedValue([]);
  prisma.projectRoleRequest.findMany.mockResolvedValue([]);
  prisma.staffingCardOrder.findMany.mockResolvedValue([]);
  prisma.formSubmission.findMany.mockResolvedValue([]);
  prisma.staffingBoardMember.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
});

describe("staffing loader", () => {
  it("redirects a viewer who cannot see staffing, without creating a cycle or returning data", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    const res = await run();
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("Location")).toBe("/");
    expect(ensureStaffingCycle).not.toHaveBeenCalled();
    expect(prisma.staffingPreference.findMany).not.toHaveBeenCalled();
  });

  it("passes the request to the memoized permission helpers", async () => {
    await run();
    expect(canViewStaffing).toHaveBeenCalledWith("u1", expect.any(Request));
    expect(canManageStaffing).toHaveBeenCalledWith("u1", expect.any(Request));
  });

  it("returns an empty board without a cycle when no terms exist", async () => {
    prisma.term.findMany.mockResolvedValue([]);
    const data = await run();
    expect(data).toMatchObject({ cycle: null, terms: [], canManage: true });
    expect(ensureStaffingCycle).not.toHaveBeenCalled();
  });

  it("reads every board member in one user query and keeps the pool flags", async () => {
    prisma.staffingPreference.findMany.mockResolvedValue([pref("u2", "p1")]);
    prisma.formSubmission.findMany.mockResolvedValue([{ userId: "u2" }, { userId: "u3" }, { userId: null }]);
    prisma.staffingBoardMember.findMany.mockResolvedValue([{ userId: "u2" }, { userId: "u3" }, { userId: "u4" }]);
    prisma.user.findMany.mockResolvedValue([userRow("u4", "Cleo"), userRow("u3", "Bea"), userRow("u2", "Ada")]);
    prisma.project.findMany.mockResolvedValue([project("p1", "Alpha")]);

    const data = await run();

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(["u2", "u3", "u4"]);
    expect(data.members.map((m: any) => [m.userId, m.unresolvedBid, m.manuallyAdded ?? false])).toEqual([
      ["u2", false, false],
      ["u3", true, false],
      ["u4", false, true],
    ]);
    expect(data.members[0].preferences).toHaveLength(1);
  });

  it("adds a non-archived project without a ProjectTerm row as a column, in sorted order", async () => {
    prisma.staffingPreference.findMany.mockResolvedValue([pref("u2", "p2")]);
    prisma.user.findMany.mockResolvedValue([userRow("u2", "Ada")]);
    prisma.project.findMany.mockImplementation(async (args: any) =>
      args.where.id ? [project("p2", "Aardvark")] : [project("p1", "Beta")],
    );
    const data = await run();
    expect(data.projects.map((p: any) => p.id)).toEqual(["p2", "p1"]);
    expect(data.projectNames).toEqual({ p1: "Beta", p2: "Aardvark" });
  });

  it("labels an archived project a member ranked without giving it a column", async () => {
    prisma.staffingPreference.findMany.mockResolvedValue([pref("u2", "old")]);
    prisma.staffingAssignment.findMany.mockResolvedValue([
      { userId: "u2", projectId: "oldAssigned", domainId: "d1", level: "Developer", status: "Proposed" },
    ]);
    prisma.user.findMany.mockResolvedValue([userRow("u2", "Ada")]);
    prisma.project.findMany.mockImplementation(async (args: any) =>
      args.where.id
        ? [project("old", "Retired", "Archived"), project("oldAssigned", "Retired Two", "Archived")]
        : [],
    );
    const data = await run();
    expect(data.projects).toEqual([]);
    expect(data.projectNames).toEqual({ old: "Retired" });
  });

  it("queries stray projects once and not at all when every project has a column", async () => {
    prisma.staffingPreference.findMany.mockResolvedValue([pref("u2", "p1")]);
    prisma.user.findMany.mockResolvedValue([userRow("u2", "Ada")]);
    prisma.project.findMany.mockResolvedValue([project("p1", "Alpha")]);
    await run();
    expect(prisma.project.findMany).toHaveBeenCalledTimes(1);
  });

  it("flags bidsFormBound from the slot binding and surfaces bid answers", async () => {
    vi.mocked(getSlotBinding).mockResolvedValue({ formId: "f1" } as never);
    vi.mocked(buildSubmissionView).mockResolvedValue({
      rows: [
        {
          userId: "u2",
          detailFields: [
            { source: "question", label: "Why", value: "Because" },
            { source: "question", label: "Blank", value: "  " },
            { source: "builtin", label: "Submitter", value: "Ada" },
          ],
        },
      ],
    } as never);
    prisma.staffingPreference.findMany.mockResolvedValue([pref("u2", "p1")]);
    prisma.user.findMany.mockResolvedValue([userRow("u2", "Ada")]);
    prisma.project.findMany.mockResolvedValue([project("p1", "Alpha")]);
    const data = await run();
    expect(data.bidsFormBound).toBe(true);
    expect(data.members[0].bidFields).toEqual([{ label: "Why", value: "Because" }]);
  });

  it("treats an unknown domain filter id as all domains", async () => {
    prisma.domain.findMany.mockResolvedValue([{ id: "d1", displayName: "Design" }]);
    prisma.staffingPreference.findMany.mockResolvedValue([pref("u2", "p1")]);
    prisma.user.findMany.mockResolvedValue([userRow("u2", "Ada")]);
    prisma.project.findMany.mockResolvedValue([project("p1", "Alpha")]);
    const unknown = await run("http://localhost/core/staffing?domain=nope");
    expect(unknown.selectedDomainId).toBe("");
    expect(unknown.members).toHaveLength(1);
  });
});
