import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/groups", () => ({ resolveGroupMembers: vi.fn() }));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn().mockResolvedValue({ inApp: 0, emailed: 0, slackDmed: 0 }) }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (v: string | null) => v) }));
vi.mock("~/forms/lib/form-usages.server", () => ({
  formUsages: vi.fn().mockResolvedValue([]),
  managingUsage: vi.fn().mockReturnValue(null),
}));

import { prisma } from "~/lib/db.server";
import { logAuditEvent } from "~/lib/audit";
import { resolveGroupMembers } from "~/lib/groups";
import { notify } from "~/lib/notify.server";
import { managingUsage } from "~/forms/lib/form-usages.server";
import {
  computeFormTracker,
  loadTrackerCounts,
  loadTrackerList,
  sendCloseReminder,
  sendFormReminder,
} from "~/forms/lib/form-tracker.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const NOW = new Date("2026-11-02T20:00:00Z");

function formRow(over: Record<string, unknown> = {}) {
  return {
    id: "f1",
    name: "Intake",
    published: true,
    publicToken: "tok",
    closesAt: new Date("2026-11-08T17:00:00Z"),
    lastRemindedAt: null,
    audience: "Groups",
    audienceGroupIds: ["g1"],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(managingUsage).mockReturnValue(null);
  db.form.findUnique.mockResolvedValue(formRow());
  db.form.updateMany.mockResolvedValue({ count: 1 });
  db.groupDefinition.findMany.mockResolvedValue([{ id: "g1", name: "Core" }]);
  vi.mocked(resolveGroupMembers).mockResolvedValue(["ada", "bo", "cy"]);
  db.notification.findMany.mockResolvedValue([]);
  db.formSubmission.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
});

describe("computeFormTracker", () => {
  it("unions the audience groups with to-do recipients and counts responders", async () => {
    db.notification.findMany.mockResolvedValue([
      { recipientUserId: "cy", readAt: null },
      { recipientUserId: "di", readAt: null },
    ]);
    db.formSubmission.findMany.mockResolvedValue([{ userId: "ada" }, { userId: null }]);
    const tracked = await computeFormTracker("f1");
    expect(tracked!.people.map((p) => p.userId).sort()).toEqual(["ada", "bo", "cy", "di"]);
    expect(await loadTrackerCounts("f1")).toEqual({ expected: 4, responded: 1 });
  });

  it("queries to-dos only, so a reminder never adds anyone", async () => {
    await computeFormTracker("f1");
    expect(db.notification.findMany.mock.calls[0][0].where).toEqual({ formId: "f1", isTodo: true });
  });

  it("counts responses across every version of signed-in people only", async () => {
    await computeFormTracker("f1");
    const where = db.formSubmission.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ formId: "f1", userId: { in: expect.arrayContaining(["ada", "bo", "cy"]) } });
    expect(where).not.toHaveProperty("formVersionId");
  });

  it("ignores audienceGroupIds unless the audience is Groups", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ audience: "Members" }));
    expect(await computeFormTracker("f1")).toBeNull();
    expect(resolveGroupMembers).not.toHaveBeenCalled();
  });

  it("expects the to-do recipients of a Public form", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ audience: "Public", audienceGroupIds: [] }));
    db.notification.findMany.mockResolvedValue([{ recipientUserId: "di", readAt: null }]);
    const tracked = await computeFormTracker("f1");
    expect(tracked!.people).toEqual([{ userId: "di", sources: ["Announcement"], responded: false, dismissed: false }]);
  });

  it("is null when nobody is expected", async () => {
    vi.mocked(resolveGroupMembers).mockResolvedValue([]);
    expect(await computeFormTracker("f1")).toBeNull();
    expect(await loadTrackerCounts("f1")).toBeNull();
  });

  it("is null for a managed form and for a missing one", async () => {
    vi.mocked(managingUsage).mockReturnValue({ kind: "hiring", label: "x" });
    expect(await computeFormTracker("f1")).toBeNull();
    vi.mocked(managingUsage).mockReturnValue(null);
    db.form.findUnique.mockResolvedValue(null);
    expect(await computeFormTracker("f1")).toBeNull();
  });
});

describe("loadTrackerList", () => {
  it("lists people who have not responded, dismissed last, with names and sources", async () => {
    db.notification.findMany.mockResolvedValue([{ recipientUserId: "ada", readAt: new Date() }]);
    db.formSubmission.findMany.mockResolvedValue([{ userId: "cy" }]);
    db.user.findMany.mockResolvedValue([
      { id: "ada", firstName: "Ada", lastName: "A", photoUrl: null },
      { id: "bo", firstName: "Bo", lastName: "B", photoUrl: "p.png" },
    ]);
    const list = await loadTrackerList("f1");
    expect(list!.expected).toBe(3);
    expect(list!.notResponded.map((p) => [p.name, p.dismissed, p.sources])).toEqual([
      ["Bo B", false, ["Core"]],
      ["Ada A", true, ["Core", "Announcement"]],
    ]);
    expect(list!.notResponded[0].photoUrl).toBe("p.png");
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["ada", "bo"] } });
  });

  it("reports the form state the modal needs", async () => {
    const list = await loadTrackerList("f1");
    expect(list).toMatchObject({
      formName: "Intake",
      published: true,
      closesAt: "2026-11-08T17:00:00.000Z",
      lastRemindedAt: null,
    });
  });
});

describe("sendFormReminder", () => {
  const send = (over: Record<string, unknown> = {}) =>
    sendFormReminder({ formId: "f1", actorId: "owner", message: "Please fill it out.", now: NOW, ...over });

  it("notifies only the server-computed people who can be reminded", async () => {
    db.notification.findMany.mockResolvedValue([{ recipientUserId: "ada", readAt: new Date() }]);
    db.formSubmission.findMany.mockResolvedValue([{ userId: "cy" }]);
    const res = await send();
    expect(res).toEqual({ ok: true, sent: 1 });
    const args = vi.mocked(notify).mock.calls[0][0];
    expect(args.recipients).toEqual([{ userId: "bo" }]);
  });

  it("ignores recipients smuggled into the call", async () => {
    await send({ userIds: ["evil"], recipients: ["evil"] });
    const ids = vi.mocked(notify).mock.calls[0][0].recipients.map((r) => r.userId);
    expect(ids.sort()).toEqual(["ada", "bo", "cy"]);
  });

  it("sends a link to the form, not a to-do, with the custom text and a dedupKey", async () => {
    await send();
    const { eventType, message, createdByUserId } = vi.mocked(notify).mock.calls[0][0];
    expect(eventType).toBe("form.reminder");
    expect(createdByUserId).toBe("owner");
    expect(message).toMatchObject({
      title: "Reminder: Intake",
      body: "Please fill it out.",
      link: "/forms/fill/tok",
      isTodo: false,
      formId: "f1",
      dedupKey: `form.reminder:f1:${NOW.toISOString()}`,
    });
  });

  it("claims the 24 hour slot atomically before sending", async () => {
    await send();
    expect(db.form.updateMany).toHaveBeenCalledWith({
      where: {
        id: "f1",
        OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: new Date("2026-11-01T20:00:00Z") } }],
      },
      data: { lastRemindedAt: NOW },
    });
    expect(db.form.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(notify).mock.invocationCallOrder[0],
    );
  });

  it("refuses with 429 and sends nothing when the claim loses a race", async () => {
    db.form.updateMany.mockResolvedValue({ count: 0 });
    const res = await send();
    expect(res).toMatchObject({ status: 429 });
    expect(notify).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous sends through", async () => {
    db.form.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const results = await Promise.all([send(), send()]);
    expect(results.filter((r) => "ok" in r)).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("does not trust a stale client view: the limit is checked on the server", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ lastRemindedAt: new Date("2026-11-02T19:00:00Z") }));
    db.form.updateMany.mockResolvedValue({ count: 0 });
    expect(await send()).toMatchObject({ status: 429 });
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses an unpublished form without claiming the slot", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ published: false }));
    expect(await send()).toMatchObject({ status: 409 });
    expect(db.form.updateMany).not.toHaveBeenCalled();
  });

  it("refuses when only dismissed people are left, without claiming the slot", async () => {
    vi.mocked(resolveGroupMembers).mockResolvedValue(["ada"]);
    db.notification.findMany.mockResolvedValue([{ recipientUserId: "ada", readAt: new Date() }]);
    expect(await send()).toMatchObject({ status: 409 });
    expect(db.form.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a managed form", async () => {
    vi.mocked(managingUsage).mockReturnValue({ kind: "hiring", label: "x" });
    expect(await send()).toMatchObject({ status: 400 });
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses an empty or oversized message", async () => {
    expect(await send({ message: "   " })).toMatchObject({ status: 400 });
    expect(await send({ message: "x".repeat(1001) })).toMatchObject({ status: 400 });
    expect(db.form.updateMany).not.toHaveBeenCalled();
  });

  it("releases the slot if delivery fails", async () => {
    vi.mocked(notify).mockRejectedValueOnce(new Error("db down"));
    await expect(send()).rejects.toThrow("db down");
    expect(db.form.updateMany).toHaveBeenLastCalledWith({
      where: { id: "f1", lastRemindedAt: NOW },
      data: { lastRemindedAt: null },
    });
  });

  it("records an audit event", async () => {
    await send();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "form.reminder.send",
        userId: "owner",
        targetId: "f1",
        metadata: { recipientCount: 3 },
      }),
    );
  });
});

describe("sendCloseReminder", () => {
  const run = () =>
    sendCloseReminder({ formId: "f1", message: (f) => `closes ${f.closesAt!.toISOString()}` });

  it("keys the notification to the close time, with no actor", async () => {
    expect(await run()).toBe(3);
    const { message, createdByUserId } = vi.mocked(notify).mock.calls[0][0];
    expect(createdByUserId).toBeNull();
    expect(message.dedupKey).toBe("form.reminder:f1:close:2026-11-08T17:00:00.000Z");
    expect(message).toMatchObject({ isTodo: false, link: "/forms/fill/tok", formId: "f1" });
  });

  it("keys a moved close time differently, so it earns one more reminder", async () => {
    await run();
    db.form.findUnique.mockResolvedValue(formRow({ closesAt: new Date("2026-11-09T17:00:00Z") }));
    await run();
    const keys = vi.mocked(notify).mock.calls.map((c) => c[0].message.dedupKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).toBe("form.reminder:f1:close:2026-11-09T17:00:00.000Z");
  });

  it("repeats the same key on a re-run, which notify() turns into a no-op", async () => {
    await run();
    await run();
    const keys = vi.mocked(notify).mock.calls.map((c) => c[0].message.dedupKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("skips unpublished forms, forms without a close time and managed forms", async () => {
    db.form.findUnique.mockResolvedValue(formRow({ published: false }));
    expect(await run()).toBe(0);
    db.form.findUnique.mockResolvedValue(formRow({ closesAt: null }));
    expect(await run()).toBe(0);
    db.form.findUnique.mockResolvedValue(formRow());
    vi.mocked(managingUsage).mockReturnValue({ kind: "staffing", label: "x" });
    expect(await run()).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not touch the manual reminder limit", async () => {
    await run();
    expect(db.form.updateMany).not.toHaveBeenCalled();
  });
});
