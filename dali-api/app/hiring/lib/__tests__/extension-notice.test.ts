import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/outbound.server", () => ({
  enqueueOutbound: vi.fn(),
  drainNow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/gmail-integration", () => ({ getApplicationsGmailRefreshToken: vi.fn() }));
vi.mock("~/hiring/lib/hiring-emails.server", () => ({ getHiringEmail: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/email-variables", () => ({
  notificationSlot: (t: string) => t,
  renderForSlot: vi.fn((_slot: string, _b: unknown, vars: Record<string, string>) => ({
    subject: `Hi ${vars.firstName}`,
    html: `<p>${vars.originalCloseDate} -> ${vars.newCloseDate}</p>`,
  })),
}));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { getHiringEmail } from "~/hiring/lib/hiring-emails.server";
import { logAuditEvent } from "~/lib/audit";
import { renderForSlot } from "~/hiring/lib/email-variables";
import { sendExtensionNoticeIfDue, resendExtensionNotice } from "~/hiring/lib/extension-notice";

const db = prisma as any;

const ORIGINAL = new Date("2026-11-01T04:59:00Z");
const EXTENDED = new Date("2026-11-08T04:59:00Z");

const cycle = (over: Record<string, unknown> = {}) => ({
  originalCloseDate: ORIGINAL,
  closeDate: EXTENDED,
  extensionNoticeSentAt: null,
  ...over,
});

const draft = (id: string, user: Record<string, unknown>) => ({ id, user: { firstName: "Ada", netId: null, dartmouthEmail: null, ...user } });

const audits = () => vi.mocked(logAuditEvent).mock.calls.map(([a]) => a as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T12:00:00Z"));
  vi.mocked(getApplicationsGmailRefreshToken).mockResolvedValue("rt" as any);
  vi.mocked(getHiringEmail).mockResolvedValue({ subject: "s", body: "b" } as any);
  vi.mocked(enqueueOutbound).mockImplementation((async (m: { target: string }) => ({ id: `out-${m.target}`, deduped: false })) as any);
  db.applicationCycle = {
    findUnique: vi.fn().mockResolvedValue(cycle()),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue({}),
  };
  db.application = {
    findMany: vi.fn().mockResolvedValue([
      draft("app1", { firstName: "Ada", dartmouthEmail: "ada@example.edu" }),
      draft("app2", { firstName: "Grace", netId: "f00grace" }),
    ]),
  };
});
afterEach(() => vi.useRealTimers());

describe("sendExtensionNoticeIfDue", () => {
  it("emails each draft applicant once, keyed by cycle and application, with the old and new close in Eastern time", async () => {
    await sendExtensionNoticeIfDue("c1");

    const sent = vi.mocked(enqueueOutbound).mock.calls.map(([m]) => m as any);
    expect(sent.map((m) => [m.target, m.dedupKey, m.eventType, m.purpose])).toEqual([
      ["ada@example.edu", "hiring.extension:c1:app1", "hiring.extension_notice", "Hiring"],
      ["f00grace@dartmouth.edu", "hiring.extension:c1:app2", "hiring.extension_notice", "Hiring"],
    ]);
    expect(sent[0].bodyHtml).toMatch(/Sunday, November 1, 2026.*12:59 AM ET ->/);
    expect(sent[0].bodyHtml).toMatch(/Saturday, November 7, 2026.*11:59 PM ET/);
    expect(drainNow).toHaveBeenCalledWith(["out-ada@example.edu", "out-f00grace@dartmouth.edu"]);
  });

  it("finds drafts as applicants who picked a domain and never submitted or withdrew", async () => {
    await sendExtensionNoticeIfDue("c1");

    expect(db.application.findMany.mock.calls[0][0].where).toEqual({
      applicationCycleId: "c1",
      domainApplications: { some: { selected: true } },
      statusUpdates: { none: { newStatus: { in: ["Submitted", "Withdrawn"] } } },
    });
  });

  it("skips applicants with no email at all", async () => {
    db.application.findMany.mockResolvedValue([draft("app1", { dartmouthEmail: null, netId: null })]);

    await sendExtensionNoticeIfDue("c1");

    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("claims the cycle marker atomically before sending and audits the result", async () => {
    await sendExtensionNoticeIfDue("c1");

    expect(db.applicationCycle.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", extensionNoticeSentAt: null },
      data: { extensionNoticeSentAt: expect.any(Date) },
    });
    expect(audits()).toEqual([
      expect.objectContaining({
        action: "email.extension_notice",
        targetId: "c1",
        metadata: { mode: "auto", attempted: 2, succeeded: 2, failed: 0, alreadySent: 0 },
      }),
    ]);
  });

  it("does nothing when another request already claimed the marker", async () => {
    db.applicationCycle.updateMany.mockResolvedValue({ count: 0 });

    await sendExtensionNoticeIfDue("c1");

    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("does nothing when a notice was already sent", async () => {
    db.applicationCycle.findUnique.mockResolvedValue(cycle({ extensionNoticeSentAt: new Date() }));

    await sendExtensionNoticeIfDue("c1");

    expect(db.applicationCycle.updateMany).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it.each([
    ["no original close (never extended)", { originalCloseDate: null }],
    ["no close date", { closeDate: null }],
    ["a close date that is not after the original", { closeDate: ORIGINAL }],
    ["a close date before the original", { closeDate: new Date("2026-10-30T00:00:00Z") }],
  ])("does nothing for %s", async (_label, over) => {
    db.applicationCycle.findUnique.mockResolvedValue(cycle(over));

    await sendExtensionNoticeIfDue("c1");

    expect(db.applicationCycle.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when the cycle is missing", async () => {
    db.applicationCycle.findUnique.mockResolvedValue(null);

    await sendExtensionNoticeIfDue("c1");

    expect(db.applicationCycle.updateMany).not.toHaveBeenCalled();
  });

  it("waits until the original close has passed", async () => {
    vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));

    await sendExtensionNoticeIfDue("c1");

    expect(db.applicationCycle.updateMany).not.toHaveBeenCalled();
  });

  it("stops once the extended close has passed", async () => {
    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));

    await sendExtensionNoticeIfDue("c1");

    expect(db.applicationCycle.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["no Gmail refresh token", () => vi.mocked(getApplicationsGmailRefreshToken).mockResolvedValue(null as any)],
    ["no bound template", () => vi.mocked(getHiringEmail).mockResolvedValue(null as any)],
  ])("leaves the marker unclaimed with %s so a later request can retry, without auditing", async (_l, setup) => {
    setup();

    await sendExtensionNoticeIfDue("c1");

    expect(db.applicationCycle.updateMany).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("swallows errors so loaders never fail, and audits the error", async () => {
    db.applicationCycle.findUnique.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendExtensionNoticeIfDue("c1")).resolves.toBeUndefined();

    expect(audits()[0].metadata).toEqual({ mode: "auto", outcome: "error", error: "db down" });
  });

  it("counts a failed recipient without stopping the rest", async () => {
    vi.mocked(enqueueOutbound).mockImplementationOnce((async () => {
      throw new Error("smtp");
    }) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await sendExtensionNoticeIfDue("c1");

    expect(audits()[0].metadata).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    expect(drainNow).toHaveBeenCalledWith(["out-f00grace@dartmouth.edu"]);
  });
});

describe("resendExtensionNotice", () => {
  it("sends even when the marker is already set, and counts already-sent recipients instead of resending", async () => {
    db.applicationCycle.findUnique.mockResolvedValue(cycle({ extensionNoticeSentAt: new Date() }));
    vi.mocked(enqueueOutbound)
      .mockResolvedValueOnce({ id: "x", deduped: true } as any)
      .mockResolvedValueOnce({ id: "out-new", deduped: false } as any);

    const res = await resendExtensionNotice("c1");

    expect(res).toEqual({ outcome: "ok", attempted: 2, succeeded: 1, failed: 0, alreadySent: 1 });
    expect(drainNow).toHaveBeenCalledWith(["out-new"]);
    expect(audits()[0].metadata).toMatchObject({ mode: "manual", alreadySent: 1 });
  });

  it("sets the cycle marker so the auto path stops", async () => {
    await resendExtensionNotice("c1");

    expect(db.applicationCycle.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { extensionNoticeSentAt: expect.any(Date) },
    });
  });

  it("reports no_extension and audits it when the cycle has no extension", async () => {
    db.applicationCycle.findUnique.mockResolvedValue(cycle({ originalCloseDate: null }));

    const res = await resendExtensionNotice("c1");

    expect(res).toEqual({ outcome: "no_extension", attempted: 0, succeeded: 0, failed: 0, alreadySent: 0 });
    expect(audits()[0].metadata).toEqual({ mode: "manual", outcome: "no_extension" });
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("reports preflight_skipped, audits it, and leaves the marker alone when Gmail is not ready", async () => {
    vi.mocked(getApplicationsGmailRefreshToken).mockResolvedValue(null as any);

    const res = await resendExtensionNotice("c1");

    expect(res.outcome).toBe("preflight_skipped");
    expect(audits()[0].metadata).toEqual({ mode: "manual", outcome: "preflight_skipped" });
    expect(db.applicationCycle.update).not.toHaveBeenCalled();
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });

  it("renders the template once per recipient with their first name", async () => {
    await resendExtensionNotice("c1");

    expect(vi.mocked(renderForSlot).mock.calls.map((c) => (c[2] as any).firstName)).toEqual(["Ada", "Grace"]);
  });
});
