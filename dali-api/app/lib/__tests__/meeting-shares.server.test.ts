import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => {
  const prisma: any = {
    scheduledMeeting: { findUnique: vi.fn() },
    meetingShareGrant: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    pageShare: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    page: { findMany: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn(), PAGE_ACCESS_SELECT: { id: true } }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));

import { prisma } from "~/lib/db";
import { getPageAccess } from "~/lib/pageAccess.server";
import { resolveGroupMembers } from "~/lib/groups";
import { removeMeetingShares, syncMeetingShares } from "~/lib/meeting-shares.server";

const m = prisma as any;
const CAN_EDIT = { canView: true, canEdit: true, canComment: true };
const CANNOT_EDIT = { canView: true, canEdit: false, canComment: true };

function meeting(over: Record<string, unknown> = {}) {
  return {
    notebookId: "nb1",
    scopeType: "UserList",
    scopeId: null,
    participantUserIds: [],
    organizerId: "org",
    notebook: { id: "nb1" },
    ...over,
  };
}
const share = (principalType: string, principalId: string, permission = "Edit", id = `s-${principalId}`) => ({
  id,
  principalType,
  principalId,
  permission,
});
const grant = (principalType: string, principalId: string, over: Record<string, unknown> = {}) => ({
  id: `g-${principalId}`,
  pageId: "nb1",
  principalType,
  principalId,
  pageShareId: `s-${principalId}`,
  createdShare: true,
  ...over,
});

/** Shares currently on the notebook; createMany adds to it so the post-create read sees them. */
function shares(rows: ReturnType<typeof share>[]) {
  const live = [...rows];
  m.pageShare.findMany.mockImplementation(async () => live);
  m.pageShare.createMany.mockImplementation(async ({ data }: any) => {
    for (const d of data) live.push(share(d.principalType, d.principalId, d.permission));
    return { count: data.length };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));
  vi.mocked(getPageAccess).mockResolvedValue(CANNOT_EDIT);
  vi.mocked(resolveGroupMembers).mockResolvedValue([]);
  m.scheduledMeeting.findUnique.mockResolvedValue(meeting());
  m.meetingShareGrant.findMany.mockResolvedValue([]);
  m.meetingShareGrant.createMany.mockResolvedValue({ count: 0 });
  m.meetingShareGrant.deleteMany.mockResolvedValue({ count: 0 });
  m.pageShare.updateMany.mockResolvedValue({ count: 0 });
  m.pageShare.deleteMany.mockResolvedValue({ count: 0 });
  m.page.findMany.mockResolvedValue([]);
  shares([]);
});

const grantedKeys = () =>
  m.meetingShareGrant.createMany.mock.calls
    .flatMap(([a]: any) => a.data)
    .map((d: any) => `${d.principalType}:${d.principalId}:${d.createdShare}`)
    .sort();

describe("syncMeetingShares — granting", () => {
  it("shares with the invited group once and with the organizer and extras individually", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(
      meeting({ scopeType: "Group", scopeId: "grp", participantUserIds: ["a", "b", "x"] }),
    );
    vi.mocked(resolveGroupMembers).mockResolvedValue(["a", "b"]);

    await syncMeetingShares("m1");

    expect(m.pageShare.createMany).toHaveBeenCalledTimes(1);
    expect(m.pageShare.createMany.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: expect.arrayContaining([
        { pageId: "nb1", principalType: "Group", principalId: "grp", permission: "Edit", createdById: "org" },
        { pageId: "nb1", principalType: "User", principalId: "x", permission: "Edit", createdById: "org" },
        { pageId: "nb1", principalType: "User", principalId: "org", permission: "Edit", createdById: "org" },
      ]),
    });
    expect(m.pageShare.createMany.mock.calls[0][0].data).toHaveLength(3);
    expect(grantedKeys()).toEqual(["Group:grp:true", "User:org:true", "User:x:true"]);
  });

  it("skips a participant whose base access already edits, judged without shares", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meeting({ participantUserIds: ["strong", "weak"] }));
    vi.mocked(getPageAccess).mockImplementation((async (u: string) =>
      u === "strong" || u === "org" ? CAN_EDIT : CANNOT_EDIT) as never);

    await syncMeetingShares("m1", undefined);

    expect(getPageAccess).toHaveBeenCalledWith("weak", { id: "nb1" }, undefined, { ignoreShares: true });
    expect(grantedKeys()).toEqual(["User:weak:true"]);
  });

  it("raises an existing View share to Edit and records it as not created", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meeting({ organizerId: "o", participantUserIds: ["u"] }));
    shares([share("User", "u", "View"), share("User", "o", "Comment")]);

    await syncMeetingShares("m1");

    expect(m.pageShare.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-u", "s-o"] } },
      data: { permission: "Edit" },
    });
    expect(m.pageShare.createMany).not.toHaveBeenCalled();
    expect(grantedKeys()).toEqual(["User:o:false", "User:u:false"]);
  });

  it("never lowers an existing FullAccess share", async () => {
    shares([share("User", "org", "FullAccess")]);

    await syncMeetingShares("m1");

    expect(m.pageShare.updateMany).not.toHaveBeenCalled();
    expect(grantedKeys()).toEqual(["User:org:false"]);
  });

  it("is a no-op when every grant already exists", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meeting({ participantUserIds: ["u"] }));
    m.meetingShareGrant.findMany.mockResolvedValue([grant("User", "org"), grant("User", "u")]);

    await syncMeetingShares("m1");

    expect(m.$transaction).not.toHaveBeenCalled();
    expect(m.pageShare.createMany).not.toHaveBeenCalled();
    expect(m.meetingShareGrant.createMany).not.toHaveBeenCalled();
    expect(m.meetingShareGrant.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing for a meeting that does not exist", async () => {
    m.scheduledMeeting.findUnique.mockResolvedValue(null);
    await syncMeetingShares("m1");
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it("logs and swallows a failure so the caller's action still succeeds", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    m.scheduledMeeting.findUnique.mockRejectedValue(new Error("db down"));

    await expect(syncMeetingShares("m1")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("syncMeetingShares — revoking", () => {
  beforeEach(() => {
    m.meetingShareGrant.findMany.mockResolvedValueOnce([grant("User", "org"), grant("User", "gone")]);
  });

  it("deletes the grant and the share it created for an uninvited user", async () => {
    await syncMeetingShares("m1");

    expect(m.meetingShareGrant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["g-gone"] } } });
    expect(m.pageShare.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s-gone"] } } });
  });

  it("keeps the share when another meeting's grant still references it", async () => {
    m.meetingShareGrant.findMany.mockResolvedValueOnce([{ pageShareId: "s-gone" }]);

    await syncMeetingShares("m1");

    expect(m.meetingShareGrant.deleteMany).toHaveBeenCalled();
    expect(m.pageShare.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps a share it only raised or reused", async () => {
    m.meetingShareGrant.findMany.mockReset();
    m.meetingShareGrant.findMany.mockResolvedValueOnce([
      grant("User", "org"),
      grant("User", "gone", { createdShare: false }),
    ]);

    await syncMeetingShares("m1");

    expect(m.meetingShareGrant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["g-gone"] } } });
    expect(m.pageShare.deleteMany).not.toHaveBeenCalled();
  });

  it("revokes grants on a notebook the meeting no longer uses", async () => {
    m.meetingShareGrant.findMany.mockReset();
    m.meetingShareGrant.findMany.mockResolvedValueOnce([grant("User", "org", { pageId: "old-nb" })]);

    await syncMeetingShares("m1");

    expect(m.meetingShareGrant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["g-org"] } } });
    expect(grantedKeys()).toEqual(["User:org:true"]);
  });
});

describe("removing a meeting's shares", () => {
  beforeEach(() => {
    m.scheduledMeeting.findUnique.mockResolvedValue(meeting({ notebookId: null, notebook: null }));
    m.meetingShareGrant.findMany.mockResolvedValueOnce([grant("User", "org"), grant("Group", "grp")]);
  });

  it("removes every grant when the meeting has no notebook", async () => {
    await syncMeetingShares("m1");

    expect(m.meetingShareGrant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["g-org", "g-grp"] } } });
    expect(m.pageShare.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s-org", "s-grp"] } } });
    expect(m.pageShare.createMany).not.toHaveBeenCalled();
    expect(getPageAccess).not.toHaveBeenCalled();
  });

  it("removeMeetingShares empties the grants", async () => {
    await removeMeetingShares("m1");

    expect(m.meetingShareGrant.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["g-org", "g-grp"] } } });
  });
});
