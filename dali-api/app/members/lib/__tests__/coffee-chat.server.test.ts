import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    coffeeChatInvite: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
    notification: { updateMany: vi.fn() },
  },
}));
vi.mock("~/lib/notify.server", () => ({ notify: vi.fn() }));
vi.mock("~/lib/notify-stream.server", () => ({ publishNotificationChange: vi.fn() }));

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { respondToCoffeeChat, sendCoffeeChatInvite } from "../coffee-chat.server";

const db = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  coffeeChatInvite: Record<"findFirst" | "create" | "updateMany" | "findUnique", ReturnType<typeof vi.fn>>;
  notification: { updateMany: ReturnType<typeof vi.fn> };
};
const mockNotify = notify as unknown as ReturnType<typeof vi.fn>;

const recipient = (openTo: { coffee?: boolean; resume?: boolean } = {}) => ({
  daliMember: { id: "dm1" },
  openToCoffeeChats: openTo.coffee ?? true,
  openToResumeReviews: openTo.resume ?? false,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.coffeeChatInvite.findFirst.mockResolvedValue(null);
  db.coffeeChatInvite.create.mockResolvedValue({ id: "inv1" });
});

describe("sendCoffeeChatInvite", () => {
  it("sends a coffee chat to someone open to them", async () => {
    db.user.findUnique.mockResolvedValue(recipient());
    expect(await sendCoffeeChatInvite("s", "r")).toBeNull();
    expect(db.coffeeChatInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { senderId: "s", recipientId: "r", kind: "CoffeeChat" } }),
    );
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "coffee_chat.invite" }));
  });

  it("refuses a coffee chat when the recipient turned them off", async () => {
    db.user.findUnique.mockResolvedValue(recipient({ coffee: false }));
    expect(await sendCoffeeChatInvite("s", "r")).toEqual({ error: "This person isn't taking coffee chat invites." });
    expect(db.coffeeChatInvite.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("refuses a resume review unless the recipient opted in", async () => {
    db.user.findUnique.mockResolvedValue(recipient());
    expect(await sendCoffeeChatInvite("s", "r", "ResumeReview")).toEqual({
      error: "This person isn't taking resume review requests.",
    });
    expect(db.coffeeChatInvite.create).not.toHaveBeenCalled();
  });

  it("sends a resume review as its own kind and event", async () => {
    db.user.findUnique.mockResolvedValue(recipient({ resume: true }));
    expect(await sendCoffeeChatInvite("s", "r", "ResumeReview")).toBeNull();
    expect(db.coffeeChatInvite.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { senderId: "s", recipientId: "r", kind: "ResumeReview" } }),
    );
    expect(db.coffeeChatInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { senderId: "s", recipientId: "r", kind: "ResumeReview" } }),
    );
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "resume_review.invite" }));
  });

  it("does not let a pending coffee chat block a resume review", async () => {
    db.user.findUnique.mockResolvedValue(recipient({ resume: true }));
    db.coffeeChatInvite.findFirst.mockImplementation(({ where }: { where: { kind: string } }) =>
      Promise.resolve(where.kind === "CoffeeChat" ? { status: "Pending", respondedAt: null } : null),
    );
    await sendCoffeeChatInvite("s", "r", "ResumeReview");
    expect(db.coffeeChatInvite.create).toHaveBeenCalled();
  });

  it("refuses someone who isn't a lab member", async () => {
    db.user.findUnique.mockResolvedValue({ ...recipient(), daliMember: null });
    expect(await sendCoffeeChatInvite("s", "r")).toEqual({ error: "This person isn't taking coffee chat invites." });
  });

  it("refuses inviting yourself", async () => {
    expect(await sendCoffeeChatInvite("s", "s")).toEqual({ error: "You can't invite yourself." });
  });
});

describe("respondToCoffeeChat", () => {
  it("clears either kind of invite from the recipient's feed", async () => {
    db.coffeeChatInvite.updateMany.mockResolvedValue({ count: 1 });
    await respondToCoffeeChat("inv1", "r", false);
    expect(db.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: { in: expect.arrayContaining(["coffee_chat.invite", "resume_review.invite"]) },
        }),
      }),
    );
  });

  it("sends the accepted events for the invite's own kind", async () => {
    db.coffeeChatInvite.updateMany.mockResolvedValue({ count: 1 });
    db.coffeeChatInvite.findUnique.mockResolvedValue({
      senderId: "s",
      kind: "ResumeReview",
      sender: { firstName: "Sam", lastName: "Okafor" },
      recipient: { firstName: "Priya", lastName: "Raman" },
    });
    await respondToCoffeeChat("inv1", "r", true);
    const calls = mockNotify.mock.calls.map(([arg]) => arg);
    expect(calls.map((c) => c.eventType)).toEqual(["resume_review.accepted", "resume_review.accepted"]);
    expect(calls[0].message.copyKey).toBe("resume_review.revealed");
  });
});
