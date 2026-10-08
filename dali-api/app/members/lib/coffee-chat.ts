// Anonymous coffee chat invites: the rules about who learns what. Client-safe
// and pure, so the anonymity guarantees are unit-tested.

export type CoffeeChatStatus = "Pending" | "Accepted" | "Declined";

type Invite = {
  id: string;
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
  | { role: "recipient"; id: string; status: CoffeeChatStatus; otherUserId: string | null }
  // The sender: a decline reads as still waiting.
  | { role: "sender"; id: string; status: "Pending" | "Accepted"; otherUserId: string };

/** What one viewer may know about an invite; null if it isn't theirs. */
export function coffeeChatViewFor(invite: Invite, viewerId: string): CoffeeChatView | null {
  if (viewerId === invite.recipientId) {
    return {
      role: "recipient",
      id: invite.id,
      status: invite.status,
      otherUserId: invite.status === "Accepted" ? invite.senderId : null,
    };
  }
  if (viewerId === invite.senderId) {
    return {
      role: "sender",
      id: invite.id,
      status: invite.status === "Accepted" ? "Accepted" : "Pending",
      otherUserId: invite.recipientId,
    };
  }
  return null;
}
