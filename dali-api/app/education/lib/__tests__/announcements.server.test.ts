import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    educationAnnouncement: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    educationApplication: { findMany: vi.fn(), findFirst: vi.fn() },
    educationOffering: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/education/lib/access.server", () => ({ isOfferingManager: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { notify } from "~/lib/notify.server";
import { isOfferingManager } from "~/education/lib/access.server";
import {
  listDiscussion,
  canPostInDiscussion,
  postAnnouncement,
  deleteAnnouncement,
} from "~/education/lib/announcements.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(notify).mockResolvedValue(undefined as never);
  mockPrisma.educationAnnouncement.create.mockResolvedValue({});
  mockPrisma.educationOffering.findUnique.mockResolvedValue({ id: "off-1", title: "Design Basics" });
  mockPrisma.educationApplication.findMany.mockResolvedValue([]);
});

describe("listDiscussion", () => {
  it("returns top-level posts only, newest first, with replies oldest-first", async () => {
    mockPrisma.educationAnnouncement.findMany.mockResolvedValue([]);
    await listDiscussion("off-1");
    const q = mockPrisma.educationAnnouncement.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ AND: [{ offeringId: "off-1", parentId: null }] });
    expect(q.orderBy).toEqual([{ sentAt: "desc" }, { id: "desc" }]);
    expect(q.select.replies.orderBy).toEqual({ sentAt: "asc" });
    expect(q.select.replies.take).toBe(200);
  });

  it("ANDs an extra filter and passes take", async () => {
    mockPrisma.educationAnnouncement.findMany.mockResolvedValue([]);
    await listDiscussion("off-1", { and: { kind: "Announcement" }, take: 5 });
    const q = mockPrisma.educationAnnouncement.findMany.mock.calls[0][0];
    expect(q.where.AND).toEqual([
      { offeringId: "off-1", parentId: null },
      { kind: "Announcement" },
    ]);
    expect(q.take).toBe(5);
  });
});

describe("canPostInDiscussion", () => {
  it("allows managers without checking enrollment", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
    expect(await canPostInDiscussion("off-1", "u")).toEqual({ allowed: true, isManager: true });
    expect(mockPrisma.educationApplication.findFirst).not.toHaveBeenCalled();
  });

  it("allows an Approved student, as a non-manager", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue({ id: "a" });
    expect(await canPostInDiscussion("off-1", "u")).toEqual({ allowed: true, isManager: false });
    expect(mockPrisma.educationApplication.findFirst.mock.calls[0][0].where).toEqual({
      offeringId: "off-1",
      applicantUserId: "u",
      status: "Approved",
    });
  });

  it("denies someone who is neither a manager nor Approved", async () => {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue(null);
    expect(await canPostInDiscussion("off-1", "u")).toEqual({ allowed: false, isManager: false });
  });
});

describe("postAnnouncement", () => {
  const base = { offeringId: "off-1", authorId: "U-Instructor", body: "  Class moved to 3pm  " };

  function asManager() {
    vi.mocked(isOfferingManager).mockResolvedValue(true);
  }
  function asStudent(enrolled = true) {
    vi.mocked(isOfferingManager).mockResolvedValue(false);
    mockPrisma.educationApplication.findFirst.mockResolvedValue(enrolled ? { id: "a" } : null);
  }
  const enrollee = (id: string, daliEmail: string | null) => ({ applicant: { id, daliEmail } });

  it("rejects an empty or whitespace body before any lookup", async () => {
    asManager();
    expect(await postAnnouncement({ ...base, body: "   " })).toEqual({
      error: "Your post can't be empty.",
      status: 400,
    });
    expect(isOfferingManager).not.toHaveBeenCalled();
  });

  it("rejects users who are not in the offering", async () => {
    asStudent(false);
    expect(await postAnnouncement(base)).toEqual({ error: "Forbidden", status: 403 });
    expect(mockPrisma.educationAnnouncement.create).not.toHaveBeenCalled();
  });

  it("404s on an unknown offering", async () => {
    asManager();
    mockPrisma.educationOffering.findUnique.mockResolvedValue(null);
    expect(await postAnnouncement(base)).toEqual({ error: "Offering not found", status: 404 });
    expect(mockPrisma.educationAnnouncement.create).not.toHaveBeenCalled();
  });

  it("manager announcement: stores the trimmed body and notifies enrollees except the author", async () => {
    asManager();
    mockPrisma.educationApplication.findMany.mockResolvedValue([
      enrollee("U-Ada", "ada@dali.dartmouth.edu"),
      enrollee("U-Grace", null),
      enrollee("U-Instructor", "inst@dali.dartmouth.edu"),
    ]);
    expect(await postAnnouncement(base)).toEqual({ ok: true });

    expect(mockPrisma.educationApplication.findMany.mock.calls[0][0].where).toEqual({
      offeringId: "off-1",
      status: "Approved",
    });
    expect(mockPrisma.educationAnnouncement.create).toHaveBeenCalledWith({
      data: {
        offeringId: "off-1",
        authorId: "U-Instructor",
        body: "Class moved to 3pm",
        kind: "Announcement",
        parentId: null,
      },
    });
    expect(notify).toHaveBeenCalledWith({
      eventType: "education.announcement",
      createdByUserId: "U-Instructor",
      message: { vars: { itemTitle: "Design Basics" }, body: "Class moved to 3pm" },
      recipients: [
        { userId: "U-Ada", link: "/education/off-1/hub" },
        { userId: "U-Grace", link: "/portal/education/off-1/hub" },
      ],
    });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "education.announcement.create",
      userId: "U-Instructor",
      targetId: "off-1",
      metadata: { recipients: 2 },
    });
  });

  it("does not call notify() when the author is the only enrollee", async () => {
    asManager();
    mockPrisma.educationApplication.findMany.mockResolvedValue([enrollee("U-Instructor", "i@dali")]);
    await postAnnouncement(base);
    expect(notify).not.toHaveBeenCalled();
    expect(mockPrisma.educationAnnouncement.create).toHaveBeenCalled();
  });

  it("still returns ok and audits when notify() fails", async () => {
    asManager();
    mockPrisma.educationApplication.findMany.mockResolvedValue([enrollee("U-Ada", "a@dali")]);
    vi.mocked(notify).mockRejectedValue(new Error("x"));
    expect(await postAnnouncement(base)).toEqual({ ok: true });
    expect(logAuditEvent).toHaveBeenCalled();
  });

  it("a manager can post a quiet Message that never fans out", async () => {
    asManager();
    mockPrisma.educationApplication.findMany.mockResolvedValue([enrollee("U-Ada", "a@dali")]);
    await postAnnouncement({ ...base, kind: "Message" });
    expect(mockPrisma.educationAnnouncement.create.mock.calls[0][0].data.kind).toBe("Message");
    expect(notify).not.toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { kind: "Message" } }),
    );
  });

  it("a student cannot broadcast: requested Announcement is downgraded to Message with no notifications", async () => {
    asStudent();
    mockPrisma.educationApplication.findMany.mockResolvedValue([enrollee("U-Ada", "a@dali")]);
    await postAnnouncement({ ...base, authorId: "U-Grace", kind: "Announcement" });
    expect(mockPrisma.educationAnnouncement.create.mock.calls[0][0].data.kind).toBe("Message");
    expect(notify).not.toHaveBeenCalled();
  });

  describe("replies", () => {
    it("404s when the parent belongs to another offering", async () => {
      asManager();
      mockPrisma.educationAnnouncement.findUnique.mockResolvedValue({ offeringId: "off-2", parentId: null });
      expect(await postAnnouncement({ ...base, parentId: "p1" })).toEqual({
        error: "Post not found",
        status: 404,
      });
      expect(mockPrisma.educationAnnouncement.create).not.toHaveBeenCalled();
    });

    it("404s when the parent does not exist", async () => {
      asManager();
      mockPrisma.educationAnnouncement.findUnique.mockResolvedValue(null);
      expect((await postAnnouncement({ ...base, parentId: "p1" }))).toEqual({
        error: "Post not found",
        status: 404,
      });
    });

    it("attaches to a top-level parent as a Message and never notifies, even from a manager", async () => {
      asManager();
      mockPrisma.educationAnnouncement.findUnique.mockResolvedValue({ offeringId: "off-1", parentId: null });
      mockPrisma.educationApplication.findMany.mockResolvedValue([enrollee("U-Ada", "a@dali")]);
      await postAnnouncement({ ...base, parentId: "p1" });
      const data = mockPrisma.educationAnnouncement.create.mock.calls[0][0].data;
      expect(data.parentId).toBe("p1");
      expect(data.kind).toBe("Message");
      expect(notify).not.toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { kind: "Reply" } }),
      );
    });

    it("flattens a reply-to-a-reply onto the root post", async () => {
      asStudent();
      mockPrisma.educationAnnouncement.findUnique.mockResolvedValue({ offeringId: "off-1", parentId: "root" });
      await postAnnouncement({ ...base, parentId: "reply-1" });
      expect(mockPrisma.educationAnnouncement.create.mock.calls[0][0].data.parentId).toBe("root");
    });
  });
});

describe("deleteAnnouncement", () => {
  const args = { postId: "p1", offeringId: "off-1", actorId: "U-Ada", isManager: false };

  it("404s for a missing post or one from another offering", async () => {
    mockPrisma.educationAnnouncement.findUnique.mockResolvedValue(null);
    expect(await deleteAnnouncement(args)).toEqual({ error: "Post not found", status: 404 });
    mockPrisma.educationAnnouncement.findUnique.mockResolvedValue({ offeringId: "off-2", authorId: "U-Ada" });
    expect(await deleteAnnouncement(args)).toEqual({ error: "Post not found", status: 404 });
    expect(mockPrisma.educationAnnouncement.delete).not.toHaveBeenCalled();
  });

  it("forbids a non-author non-manager", async () => {
    mockPrisma.educationAnnouncement.findUnique.mockResolvedValue({ offeringId: "off-1", authorId: "U-Grace" });
    expect(await deleteAnnouncement(args)).toEqual({ error: "Forbidden", status: 403 });
    expect(mockPrisma.educationAnnouncement.delete).not.toHaveBeenCalled();
  });

  it("lets the author delete their own post and audits it", async () => {
    mockPrisma.educationAnnouncement.findUnique.mockResolvedValue({ offeringId: "off-1", authorId: "U-Ada" });
    expect(await deleteAnnouncement(args)).toEqual({ ok: true });
    expect(mockPrisma.educationAnnouncement.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    expect(logAuditEvent).toHaveBeenCalledWith({
      action: "education.announcement.delete",
      userId: "U-Ada",
      targetId: "off-1",
      metadata: { postId: "p1" },
    });
  });

  it("lets a manager delete someone else's post", async () => {
    mockPrisma.educationAnnouncement.findUnique.mockResolvedValue({ offeringId: "off-1", authorId: "U-Grace" });
    expect(await deleteAnnouncement({ ...args, isManager: true })).toEqual({ ok: true });
    expect(mockPrisma.educationAnnouncement.delete).toHaveBeenCalled();
  });
});
