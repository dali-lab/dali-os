import { describe, expect, it } from "vitest";
import {
  ANSWER_TO_CLEAR_EVENTS,
  KIND_EVENTS,
  blocksNewInvite,
  coffeeChatViewFor,
  inviteCopy,
  type CoffeeChatKind,
  type CoffeeChatStatus,
} from "../coffee-chat";

const invite = (status: CoffeeChatStatus, kind: CoffeeChatKind = "CoffeeChat") => ({
  id: "i1",
  kind,
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

  it("carries the invite's kind to both people", () => {
    expect(coffeeChatViewFor(invite("Pending", "ResumeReview"), "recipient")).toMatchObject({ kind: "ResumeReview" });
    expect(coffeeChatViewFor(invite("Pending", "ResumeReview"), "sender")).toMatchObject({ kind: "ResumeReview" });
  });

  it("keeps a resume review just as anonymous as a coffee chat", () => {
    expect(coffeeChatViewFor(invite("Pending", "ResumeReview"), "recipient")).toMatchObject({ otherUserId: null });
    expect(coffeeChatViewFor(invite("Declined", "ResumeReview"), "sender")).toMatchObject({ status: "Pending" });
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

describe("KIND_EVENTS", () => {
  it("gives each kind its own invite and accepted events", () => {
    expect(KIND_EVENTS.CoffeeChat.invite).toBe("coffee_chat.invite");
    expect(KIND_EVENTS.ResumeReview.invite).toBe("resume_review.invite");
    expect(KIND_EVENTS.ResumeReview.accepted).toBe("resume_review.accepted");
  });

  it("lists every kind's invite as answer-to-clear", () => {
    expect([...ANSWER_TO_CLEAR_EVENTS].sort()).toEqual(["coffee_chat.invite", "resume_review.invite"]);
  });
});

describe("inviteCopy", () => {
  const view = (role: "sender" | "recipient", status: CoffeeChatStatus, kind: CoffeeChatKind = "CoffeeChat") =>
    ({ role, status, kind }) as Parameters<typeof inviteCopy>[0];

  it("keeps the coffee chat wording unchanged", () => {
    expect(inviteCopy(view("recipient", "Pending"), null).title).toBe("Someone wants to grab coffee with you");
    expect(inviteCopy(view("sender", "Accepted"), "Priya Raman").title).toBe("Priya Raman accepted your coffee chat");
    expect(inviteCopy(view("recipient", "Accepted"), "Priya Raman").title).toBe("Coffee chat with Priya Raman");
    expect(inviteCopy(view("recipient", "Declined"), null).title).toBe("You declined this coffee chat");
  });

  it("words a resume review as one", () => {
    expect(inviteCopy(view("recipient", "Pending", "ResumeReview"), null).title).toBe(
      "Someone wants you to review their resume",
    );
    expect(inviteCopy(view("sender", "Accepted", "ResumeReview"), "Priya Raman").title).toBe(
      "Priya Raman accepted your resume review",
    );
    expect(inviteCopy(view("recipient", "Accepted", "ResumeReview"), "Priya Raman").title).toBe(
      "Resume review for Priya Raman",
    );
    expect(inviteCopy(view("sender", "Pending", "ResumeReview"), "Priya Raman").detail).toContain("request is anonymous");
  });

  it("never names anyone in the pending recipient copy", () => {
    for (const kind of ["CoffeeChat", "ResumeReview"] as const) {
      const { title, detail } = inviteCopy(view("recipient", "Pending", kind), "Secret Sender");
      expect(`${title} ${detail}`).not.toContain("Secret Sender");
    }
  });
});
