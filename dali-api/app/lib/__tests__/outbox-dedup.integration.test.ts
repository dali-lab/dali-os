import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmail, sendDm } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => undefined), sendDm: vi.fn(async () => undefined) }));
vi.mock("~/lib/gmail", () => ({ sendEmail }));
vi.mock("~/lib/gmail-integration.server", () => ({
  getSender: vi.fn(async () => ({ id: "sender-1", refreshToken: "tok", sendAsEmail: "noreply@example.edu" })),
  noteSenderHealth: vi.fn(async () => undefined),
}));
vi.mock("~/slack/lib/slack-client", () => ({
  sendDm,
  postMessage: vi.fn(),
  postBlocks: vi.fn(),
  uploadFileToThread: vi.fn(),
  slackConfigured: vi.fn(() => false),
}));
vi.mock("~/lib/s3.server", () => ({ getObjectBytes: vi.fn() }));
vi.mock("~/lib/notify-stream.server", () => ({ publishNotificationChange: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { enqueueOutbound } from "~/lib/outbound.server";
import { notify } from "~/lib/notify.server";

const email = (dedupKey: string | null, target = "ada@example.edu") =>
  enqueueOutbound({ channel: "email", purpose: "General", dedupKey, target, subject: "Hi", bodyHtml: "<p>hi</p>" });

beforeEach(() => {
  sendEmail.mockClear();
  sendDm.mockClear();
});

describe("enqueueOutbound dedup (real database)", () => {
  it("a repeated dedupKey on one channel enqueues once and reports the duplicate", async () => {
    const first = await email("welcome:ada");
    const second = await email("welcome:ada");

    expect(first.deduped).toBe(false);
    expect(first.id).toEqual(expect.any(String));
    expect(second).toEqual({ id: null, deduped: true });
    expect(await prisma.outboundMessage.count()).toBe(1);
  });

  it("concurrent enqueues of the same key produce exactly one row", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => email("race:key")));

    expect(results.filter((r) => !r.deduped)).toHaveLength(1);
    expect(results.filter((r) => r.deduped)).toHaveLength(9);
    expect(await prisma.outboundMessage.count({ where: { dedupKey: "race:key" } })).toBe(1);
  });

  it("different keys both land, and the same key on a different channel is independent", async () => {
    await email("k1");
    await email("k2");
    const dm = await enqueueOutbound({ channel: "slack_dm", dedupKey: "k1", target: "U1", slackText: "yo" });

    expect(dm.deduped).toBe(false);
    expect(await prisma.outboundMessage.count()).toBe(3);
  });

  it("unkeyed sends never collide", async () => {
    await Promise.all([email(null), email(null), email(null)]);

    expect(await prisma.outboundMessage.count()).toBe(3);
  });
});

describe("notify() dedup (real database)", () => {
  async function member(first: string, daliEmail: string) {
    return prisma.user.create({ data: { firstName: first, lastName: "Tester", daliEmail } });
  }
  const fire = (userId: string, dedupKey: string | null) =>
    notify({
      eventType: "staffing.assigned",
      message: { title: "Assigned", body: "You are on Atlas", link: "/projects/p1", dedupKey },
      recipients: [{ userId }],
    });

  it("a re-fired keyed notify writes one notification, one email row, and sends one email", async () => {
    const ada = await member("Ada", "ada@example.edu");

    const first = await fire(ada.id, "assign:p1");
    const second = await fire(ada.id, "assign:p1");

    expect(first).toMatchObject({ inApp: 1, emailed: 1 });
    expect(second).toMatchObject({ inApp: 0, emailed: 0 });
    expect(await prisma.notification.count({ where: { recipientUserId: ada.id } })).toBe(1);
    const out = await prisma.outboundMessage.findMany();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ dedupKey: `notif:assign:p1:${ada.id}:email`, status: "Sent", target: "ada@example.edu" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("concurrent keyed notifies deliver exactly once", async () => {
    const ada = await member("Ada", "ada@example.edu");

    await Promise.all(Array.from({ length: 6 }, () => fire(ada.id, "assign:race")));

    expect(await prisma.notification.count({ where: { recipientUserId: ada.id } })).toBe(1);
    expect(await prisma.outboundMessage.count()).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("different keys, and different recipients with the same key, each get their own", async () => {
    const ada = await member("Ada", "ada@example.edu");
    const alan = await member("Alan", "alan@example.edu");

    await fire(ada.id, "a");
    await fire(ada.id, "b");
    await fire(alan.id, "a");

    expect(await prisma.notification.count()).toBe(3);
    expect(await prisma.outboundMessage.count()).toBe(3);
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it("unkeyed notifies always deliver", async () => {
    const ada = await member("Ada", "ada@example.edu");

    await fire(ada.id, null);
    await fire(ada.id, null);

    expect(await prisma.notification.count()).toBe(2);
    expect(await prisma.outboundMessage.count()).toBe(2);
  });
});
