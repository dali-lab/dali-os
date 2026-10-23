// Anonymous coffee chat invites: the rules about who learns what. Client-safe
// and pure, so the anonymity guarantees are unit-tested.

export type CoffeeChatStatus = "Pending" | "Accepted" | "Declined";
export type CoffeeChatKind = "CoffeeChat" | "ResumeReview";

/**
 * What each kind sends: `invite` to the recipient, `accepted` to both people on
 * accept, where the recipient's copy names the sender (`revealedCopy`).
 */
export const KIND_EVENTS = {
  CoffeeChat: { invite: "coffee_chat.invite", accepted: "coffee_chat.accepted", revealedCopy: "coffee_chat.revealed" },
  ResumeReview: { invite: "resume_review.invite", accepted: "resume_review.accepted", revealedCopy: "resume_review.revealed" },
} as const satisfies Record<CoffeeChatKind, { invite: string; accepted: string; revealedCopy: string }>;

/** Invite event types that clear only when answered, never by opening or dismissing. */
export const ANSWER_TO_CLEAR_EVENTS: readonly string[] = Object.values(KIND_EVENTS).map((e) => e.invite);

type Invite = {
  id: string;
  kind: CoffeeChatKind;
  senderId: string;
  recipientId: string;
  status: CoffeeChatStatus;
  respondedAt: Date | null;
};

// After a decline the sender can't re-invite the same person for this long.
const RESEND_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether the sender's latest invite to someone still stands in the way of a
 * new one. A recent decline blocks exactly like a pending invite, so the
 * sender's button can't be used to find out they were turned down.
 */
export function blocksNewInvite(
  latest: Pick<Invite, "status" | "respondedAt"> | null,
  now: Date,
): boolean {
  if (!latest) return false;
  if (latest.status === "Pending") return true;
  if (latest.status === "Declined") {
    return !latest.respondedAt || now.getTime() - latest.respondedAt.getTime() < RESEND_COOLDOWN_MS;
  }
  return false;
}

export type CoffeeChatView =
  // The recipient: the sender's id is present only once they have accepted.
  | { role: "recipient"; id: string; kind: CoffeeChatKind; status: CoffeeChatStatus; otherUserId: string | null }
  // The sender: a decline reads as still waiting.
  | { role: "sender"; id: string; kind: CoffeeChatKind; status: "Pending" | "Accepted"; otherUserId: string };

/** What one viewer may know about an invite; null if it isn't theirs. */
export function coffeeChatViewFor(invite: Invite, viewerId: string): CoffeeChatView | null {
  if (viewerId === invite.recipientId) {
    return {
      role: "recipient",
      id: invite.id,
      kind: invite.kind,
      status: invite.status,
      otherUserId: invite.status === "Accepted" ? invite.senderId : null,
    };
  }
  if (viewerId === invite.senderId) {
    return {
      role: "sender",
      id: invite.id,
      kind: invite.kind,
      status: invite.status === "Accepted" ? "Accepted" : "Pending",
      otherUserId: invite.recipientId,
    };
  }
  return null;
}

export const KIND_HEADINGS: Record<CoffeeChatKind, string> = {
  CoffeeChat: "Coffee chat",
  ResumeReview: "Resume review",
};

/** The invite page's headline and explainer for one viewer. */
export function inviteCopy(
  view: Pick<CoffeeChatView, "role" | "kind" | "status">,
  otherName: string | null,
): { title: string; detail: string } {
  const chat = view.kind === "CoffeeChat";
  const noun = chat ? "coffee chat" : "resume review";
  const next = chat ? "Reach out to pick a time." : "Reach out to swap the resume.";
  if (view.role === "sender") {
    return view.status === "Accepted"
      ? { title: `${otherName ?? "They"} accepted your ${noun}`, detail: `They can see your name now. ${next}` }
      : {
          title: `Waiting on ${otherName ?? "them"}`,
          detail: `Your ${chat ? "invite" : "request"} is anonymous. They'll see your name only if they accept.`,
        };
  }
  if (view.status === "Pending") {
    return {
      title: chat ? "Someone wants to grab coffee with you" : "Someone wants you to review their resume",
      detail: "You'll see who it is only if you accept. If you decline, they won't be told.",
    };
  }
  if (view.status === "Accepted") {
    return {
      title: chat ? `Coffee chat with ${otherName ?? "a DALI member"}` : `Resume review for ${otherName ?? "a DALI member"}`,
      detail: `They've been told you accepted. ${next}`,
    };
  }
  return { title: `You declined this ${noun}`, detail: "They weren't told." };
}
