import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/gmail", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("~/lib/gmail-integration", () => ({
  getSender: vi.fn(async () => ({ id: "sender-1", refreshToken: "tok", sendAsEmail: "noreply@example.edu" })),
  noteSenderHealth: vi.fn(async () => undefined),
}));
vi.mock("~/slack/lib/slack-client", () => ({
  sendDm: vi.fn(),
  postMessage: vi.fn(),
  postBlocks: vi.fn(),
  uploadFileToThread: vi.fn(),
  slackConfigured: vi.fn(() => false),
}));
vi.mock("~/lib/s3", () => ({ getObjectBytes: vi.fn() }));
vi.mock("~/lib/notify-stream.server", () => ({ publishNotificationChange: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";

async function members() {
  return Promise.all(
    [
      ["Ada", "ada@example.edu"],
      ["Bo", "bo@example.edu"],
      ["Cy", "cy@example.edu"],
    ].map(([firstName, daliEmail]) =>
      prisma.user.create({ data: { firstName, lastName: "Tester", daliEmail } }),
    ),
  );
}

const fire = (userIds: string[], dedupKey: string) =>
  notify({
    eventType: "staffing.assigned",
    message: { title: "Assigned", body: "You are on Atlas", link: "/projects/p1", dedupKey },
    recipients: userIds.map((userId) => ({ userId })),
  });

describe("notify() keyed batch (real database)", () => {
  it("a re-fired keyed notify to several recipients adds no rows and enqueues nothing", async () => {
    const users = await members();
    const ids = users.map((u) => u.id);

    const first = await fire(ids, "assign:p1");
    const outboundAfterFirst = await prisma.outboundMessage.count();
    const second = await fire(ids, "assign:p1");

    expect(first.inApp).toBe(3);
    expect(second.inApp).toBe(0);
    expect(await prisma.notification.count()).toBe(3);
    expect(await prisma.outboundMessage.count()).toBe(outboundAfterFirst);
  });

  it("only recipients without the key get a row when one already has it", async () => {
    const [ada, bo, cy] = await members();
    await fire([ada.id], "assign:p2");

    const res = await fire([ada.id, bo.id, cy.id], "assign:p2");

    expect(res.inApp).toBe(2);
    expect(await prisma.notification.count({ where: { dedupKey: "assign:p2" } })).toBe(3);
    expect(await prisma.notification.count({ where: { recipientUserId: ada.id } })).toBe(1);
  });
});
