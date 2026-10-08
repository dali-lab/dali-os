import { describe, expect, it } from "vitest";
import { blocksNewInvite, coffeeChatViewFor, type CoffeeChatStatus } from "../coffee-chat";

const invite = (status: CoffeeChatStatus) => ({
  id: "i1",
  senderId: "sender",
  recipientId: "recipient",
  status,
  respondedAt: status === "Pending" ? null : new Date("2026-10-01T00:00:00Z"),
});

describe("coffeeChatViewFor", () => {
  it("hides the sender from the recipient until they accept", () => {
    expect(coffeeChatViewFor(invite("Pending"), "recipient")).toMatchObject({ otherUserId: null });
    expect(coffeeChatViewFor(invite("Declined"), "recipient")).toMatchObject({ otherUserId: null });
    expect(coffeeChatViewFor(invite("Accepted"), "recipient")).toMatchObject({ otherUserId: "sender" });
  });

  it("shows the sender a decline as still waiting", () => {
    expect(coffeeChatViewFor(invite("Declined"), "sender")).toMatchObject({ status: "Pending" });
    expect(coffeeChatViewFor(invite("Accepted"), "sender")).toMatchObject({ status: "Accepted" });
  });

  it("shows nothing to anyone else", () => {
    expect(coffeeChatViewFor(invite("Accepted"), "bystander")).toBeNull();
  });
});

describe("blocksNewInvite", () => {
  const now = new Date("2026-10-08T00:00:00Z");
  const declinedAt = (iso: string) => ({ status: "Declined" as const, respondedAt: new Date(iso) });

  it("blocks while an invite is pending, and for 30 days after a decline", () => {
    expect(blocksNewInvite({ status: "Pending", respondedAt: null }, now)).toBe(true);
    expect(blocksNewInvite(declinedAt("2026-10-01T00:00:00Z"), now)).toBe(true);
    expect(blocksNewInvite(declinedAt("2026-09-01T00:00:00Z"), now)).toBe(false);
  });

  it("allows a first invite, and another after an accepted one", () => {
    expect(blocksNewInvite(null, now)).toBe(false);
    expect(blocksNewInvite({ status: "Accepted", respondedAt: now }, now)).toBe(false);
  });
});
