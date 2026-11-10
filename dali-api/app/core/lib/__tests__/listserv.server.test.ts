import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listservConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  listservSubmission: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { notify } from "~/lib/notify.server";
import {
  actOnListserv,
  checkDraft,
  isListservLead,
  listListserv,
  markListservSent,
  submitListserv,
} from "~/core/lib/listserv.server";
import type { ListservDraft } from "~/core/lib/listserv";

const draft = (over: Partial<ListservDraft> = {}): ListservDraft => ({
  subject: " Open house ",
  content: [{ id: "b1", type: "text", text: "Come by" }],
  attachments: [],
  sendBy: "",
  note: "",
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  db.listservConfig.findUnique.mockResolvedValue({ leadUserId: "lead", fromAddress: "dali@dartmouth.edu" });
  db.user.findUnique.mockResolvedValue({ firstName: "Maya", lastName: "Patel" });
  db.listservSubmission.updateMany.mockResolvedValue({ count: 1 });
});

describe("isListservLead", () => {
  it("is the configured lead, or any admin standing in", () => {
    expect(isListservLead("lead", { leadUserId: "lead" }, false)).toBe(true);
    expect(isListservLead("someone", { leadUserId: "lead" }, false)).toBe(false);
    expect(isListservLead("someone", { leadUserId: null }, false)).toBe(false);
    expect(isListservLead("admin", { leadUserId: null }, true)).toBe(true);
  });
});

describe("checkDraft", () => {
  const today = "2026-10-24";

  it("accepts plain text and https or own-upload images", () => {
    expect(checkDraft(draft(), today)).toBeNull();
    expect(
      checkDraft(
        draft({
          content: [
            { id: "i", type: "image", url: "https://x/a.png", caption: "" },
            { id: "j", type: "image", url: "/api/upload/raw?key=uploads%2Flistserv%2Fa.png", caption: "" },
          ],
        }),
        today,
      ),
    ).toBeNull();
  });

  it("refuses an empty email", () => {
    expect(checkDraft(draft({ content: [{ id: "b", type: "text", text: " " }] }), today)?.field).toBe("content");
  });

  it("refuses images and attachments that point at someone else's uploads", () => {
    const foreign = "/api/upload/raw?key=uploads%2Fprojects%2Fsecret.png";
    expect(checkDraft(draft({ content: [{ id: "i", type: "image", url: foreign, caption: "" }] }), today)?.field).toBe("content");
    expect(checkDraft(draft({ content: [{ id: "i", type: "image", url: "http://x/a.png", caption: "" }] }), today)?.field).toBe("content");
    expect(checkDraft(draft({ attachments: [{ key: "uploads/projects/x.pdf", name: "x.pdf", size: 1 }] }), today)?.field).toBe(
      "attachments",
    );
    expect(checkDraft(draft({ attachments: [{ key: "uploads/listserv/../projects/x", name: "x", size: 1 }] }), today)?.field).toBe(
      "attachments",
    );
    expect(checkDraft(draft({ attachments: [{ key: "uploads/listserv/a-x.pdf", name: "x.pdf", size: 1 }] }), today)).toBeNull();
  });

  it("refuses a send-by day in the past", () => {
    expect(checkDraft(draft({ sendBy: "2026-10-23" }), today)?.field).toBe("sendBy");
    expect(checkDraft(draft({ sendBy: "2026-10-24" }), today)).toBeNull();
  });
});

describe("submitListserv", () => {
  it("stores the trimmed draft as a calendar day and tells the lead", async () => {
    db.listservSubmission.create.mockResolvedValue({ id: "ls1" });
    await submitListserv(draft({ sendBy: "2026-11-02", note: "  " }), "maya");
    const data = db.listservSubmission.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ subject: "Open house", note: null, submittedById: "maya" });
    expect(data.sendBy.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      eventType: "listserv",
      message: { copyKey: "listserv.submitted", vars: { itemTitle: "Open house", personName: "Maya Patel" } },
      recipients: [{ userId: "lead" }],
    });
  });

  it("doesn't notify the lead about their own submission", async () => {
    db.listservSubmission.create.mockResolvedValue({ id: "ls1" });
    await submitListserv(draft(), "lead");
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("actOnListserv", () => {
  const row = (status: string, submittedById = "maya") => ({ status, submittedById, subject: "Open house" });

  it("approves from review, clears feedback, and tells the submitter", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(row("Submitted"));
    expect(await actOnListserv({ id: "ls1", action: "approve", actorId: "lead", isLead: true })).toEqual({ ok: true });
    expect(db.listservSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: "ls1", status: "Submitted" },
      data: { status: "Approved", feedback: null, reviewedById: "lead" },
    });
    expect(vi.mocked(notify).mock.calls[0][0].message.copyKey).toBe("listserv.approved");
  });

  it("refuses review actions from someone who isn't the lead", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(row("Submitted"));
    const out = await actOnListserv({ id: "ls1", action: "approve", actorId: "maya", isLead: false });
    expect(out.ok).toBe(false);
    expect(db.listservSubmission.updateMany).not.toHaveBeenCalled();
  });

  it("needs feedback to request changes, and passes it to the submitter", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(row("Submitted"));
    expect((await actOnListserv({ id: "ls1", action: "request-changes", actorId: "lead", isLead: true, feedback: " " })).ok).toBe(false);
    await actOnListserv({ id: "ls1", action: "request-changes", actorId: "lead", isLead: true, feedback: " Add the room " });
    expect(db.listservSubmission.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ChangesRequested", feedback: "Add the room" });
    expect(vi.mocked(notify).mock.calls[0][0].message.vars).toEqual({ itemTitle: "Open house", itemDetail: "Add the room" });
  });

  it("sends an edited email back to review and tells the lead", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(row("Approved"));
    await actOnListserv({ id: "ls1", action: "edit", actorId: "maya", isLead: false, draft: draft({ subject: "New subject" }) });
    expect(db.listservSubmission.updateMany.mock.calls[0][0].data).toMatchObject({
      subject: "New subject",
      status: "Submitted",
      feedback: null,
    });
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({
      message: { copyKey: "listserv.submitted", vars: { itemTitle: "New subject" } },
      recipients: [{ userId: "lead" }],
    });
  });

  it("only lets the submitter edit or withdraw", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(row("Submitted"));
    expect((await actOnListserv({ id: "ls1", action: "withdraw", actorId: "lead", isLead: true })).ok).toBe(false);
    expect((await actOnListserv({ id: "ls1", action: "withdraw", actorId: "maya", isLead: false })).ok).toBe(true);
    expect(db.listservSubmission.deleteMany).toHaveBeenCalledWith({ where: { id: "ls1", status: "Submitted" } });
  });

  it("puts a sent email back in the ready list when the lead undoes it", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(row("Sent"));
    await actOnListserv({ id: "ls1", action: "unmark-sent", actorId: "lead", isLead: true });
    expect(db.listservSubmission.updateMany.mock.calls[0][0].data).toEqual({ status: "Approved", sentOn: null, sentById: null });
  });

  it("reports a lost race instead of claiming success", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(row("Submitted"));
    db.listservSubmission.updateMany.mockResolvedValue({ count: 0 });
    const out = await actOnListserv({ id: "ls1", action: "approve", actorId: "lead", isLead: true });
    expect(out.ok).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("says so when the submission is gone", async () => {
    db.listservSubmission.findUnique.mockResolvedValue(null);
    expect((await actOnListserv({ id: "x", action: "approve", actorId: "lead", isLead: true })).ok).toBe(false);
  });
});

describe("markListservSent", () => {
  const now = new Date("2026-10-24T16:00:00Z");

  it("refuses a day that hasn't happened yet", async () => {
    const out = await markListservSent(["ls1"], "2026-10-25", "lead", now);
    expect(out.ok).toBe(false);
    expect(db.listservSubmission.updateMany).not.toHaveBeenCalled();
  });

  it("marks only the approved ones and tells each submitter", async () => {
    db.listservSubmission.findMany.mockResolvedValue([
      { id: "ls1", submittedById: "maya", subject: "A" },
      { id: "ls2", submittedById: "ava", subject: "B" },
    ]);
    const out = await markListservSent(["ls1", "ls2", "ls3"], "2026-10-22", "lead", now);
    expect(out).toEqual({ ok: true, count: 2 });
    expect(db.listservSubmission.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["ls1", "ls2", "ls3"] }, status: "Approved" });
    const update = db.listservSubmission.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: { in: ["ls1", "ls2"] }, status: "Approved" });
    expect(update.data.sentOn.toISOString()).toBe("2026-10-22T00:00:00.000Z");
    expect(vi.mocked(notify).mock.calls.map((c) => c[0].message.vars)).toEqual([
      { itemTitle: "A", when: "on Thu, Oct 22" },
      { itemTitle: "B", when: "on Thu, Oct 22" },
    ]);
  });

  it("says today when it went out today", async () => {
    db.listservSubmission.findMany.mockResolvedValue([{ id: "ls1", submittedById: "maya", subject: "A" }]);
    await markListservSent(["ls1"], "2026-10-24", "lead", now);
    expect(vi.mocked(notify).mock.calls[0]![0].message.vars?.when).toBe("today");
  });

  it("refuses when none are ready", async () => {
    db.listservSubmission.findMany.mockResolvedValue([]);
    expect((await markListservSent(["ls1"], "2026-10-24", "lead", now)).ok).toBe(false);
  });
});

describe("listListserv", () => {
  it("keeps everything in progress plus recent sends, with names and file links", async () => {
    db.listservSubmission.findMany.mockResolvedValue([
      {
        id: "ls1",
        status: "Sent",
        subject: "A",
        content: [{ id: "b", type: "text", text: "x" }, { bogus: true }],
        attachments: [{ key: "uploads/listserv/a.pdf", name: "a.pdf", size: 10 }],
        sendBy: null,
        sentOn: new Date("2026-10-20T00:00:00Z"),
        note: null,
        feedback: null,
        submittedAt: new Date("2026-10-18T12:00:00Z"),
        submittedById: "maya",
      },
    ]);
    db.user.findMany.mockResolvedValue([{ id: "maya", firstName: "Maya", lastName: "Patel" }]);
    const now = new Date("2026-10-24T00:00:00Z");
    const [row] = await listListserv(now);
    const where = db.listservSubmission.findMany.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ status: { not: "Sent" } });
    expect(where.OR[1].sentOn.gte.toISOString()).toBe("2026-06-26T00:00:00.000Z");
    // A malformed block list is dropped rather than crashing the page.
    expect(row.content).toEqual([]);
    expect(row.sentOn).toBe("2026-10-20");
    expect(row.submitter).toEqual({ id: "maya", name: "Maya Patel" });
    expect(row.attachments[0].url).toBe("/api/upload/raw?key=uploads%2Flistserv%2Fa.pdf");
  });
});
