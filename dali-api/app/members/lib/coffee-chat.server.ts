import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { publishNotificationChange } from "~/lib/notify-stream.server";
import { fullName } from "~/lib/display";
import {
  ANSWER_TO_CLEAR_EVENTS,
  KIND_EVENTS,
  blocksNewInvite,
  coffeeChatViewFor,
  type CoffeeChatKind,
  type CoffeeChatView,
} from "./coffee-chat";

const linkFor = (inviteId: string) => `/coffee-chats/${inviteId}`;

const KIND_NOUN: Record<CoffeeChatKind, string> = {
  CoffeeChat: "coffee chat invites",
  ResumeReview: "resume review requests",
};

async function latestInvite(senderId: string, recipientId: string, kind: CoffeeChatKind) {
  return prisma.coffeeChatInvite.findFirst({
    where: { senderId, recipientId, kind },
    orderBy: { createdAt: "desc" },
    select: { status: true, respondedAt: true },
  });
}

/** Whether the viewer already has an invite out to this person. */
export async function hasOutgoingCoffeeChat(
  senderId: string,
  recipientId: string,
  kind: CoffeeChatKind = "CoffeeChat",
): Promise<boolean> {
  return blocksNewInvite(await latestInvite(senderId, recipientId, kind), new Date());
}

export async function sendCoffeeChatInvite(
  senderId: string,
  recipientId: string,
  kind: CoffeeChatKind = "CoffeeChat",
): Promise<{ error: string } | null> {
  if (senderId === recipientId) return { error: "You can't invite yourself." };
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { daliMember: { select: { id: true } }, openToCoffeeChats: true, openToResumeReviews: true },
  });
  const open = kind === "CoffeeChat" ? recipient?.openToCoffeeChats : recipient?.openToResumeReviews;
  if (!recipient?.daliMember || !open) return { error: `This person isn't taking ${KIND_NOUN[kind]}.` };
  // Already out (or recently declined): succeed quietly, send nothing.
  if (await hasOutgoingCoffeeChat(senderId, recipientId, kind)) return null;

  const invite = await prisma.coffeeChatInvite.create({
    data: { senderId, recipientId, kind },
    select: { id: true },
  });
  // No createdByUserId: the notification row and the email must not carry the
  // sender.
  await notify({
    eventType: KIND_EVENTS[kind].invite,
    message: { vars: {}, link: linkFor(invite.id), dedupKey: `coffee-chat:${invite.id}` },
    recipients: [{ userId: recipientId }],
  });
  return null;
}

export async function respondToCoffeeChat(
  inviteId: string,
  viewerId: string,
  accept: boolean,
): Promise<{ error: string } | null> {
  // Only the recipient, and only once.
  const { count } = await prisma.coffeeChatInvite.updateMany({
    where: { id: inviteId, recipientId: viewerId, status: "Pending" },
    data: { status: accept ? "Accepted" : "Declined", respondedAt: new Date() },
  });
  if (count === 0) return { error: "This invite was already answered." };

  // Answering is what clears the invite from the recipient's tasks.
  await prisma.notification.updateMany({
    where: { recipientUserId: viewerId, eventType: { in: [...ANSWER_TO_CLEAR_EVENTS] }, link: linkFor(inviteId), readAt: null },
    data: { readAt: new Date() },
  });
  publishNotificationChange([viewerId]);
  if (!accept) return null; // a decline tells the sender nothing

  const invite = await prisma.coffeeChatInvite.findUnique({
    where: { id: inviteId },
    select: {
      senderId: true,
      kind: true,
      sender: { select: { firstName: true, lastName: true } },
      recipient: { select: { firstName: true, lastName: true } },
    },
  });
  if (invite) {
    const events = KIND_EVENTS[invite.kind];
    // The recipient's record of who it was: the invite card is gone now, so
    // this row (and its email) is where the name lives.
    await notify({
      eventType: events.accepted,
      createdByUserId: invite.senderId,
      message: {
        copyKey: events.revealedCopy,
        vars: { personName: fullName(invite.sender) || "A DALI member" },
        link: linkFor(inviteId),
        dedupKey: `coffee-chat-revealed:${inviteId}`,
      },
      recipients: [{ userId: viewerId }],
    });
    await notify({
      eventType: events.accepted,
      createdByUserId: viewerId,
      message: {
        vars: { personName: fullName(invite.recipient) || "Someone" },
        link: linkFor(inviteId),
        dedupKey: `coffee-chat-accepted:${inviteId}`,
      },
      recipients: [{ userId: invite.senderId }],
    });
  }
  return null;
}

export type CoffeeChatPage = CoffeeChatView & {
  other: { id: string; name: string; email: string | null } | null;
};

/** The invite as this viewer may see it, or null if it isn't theirs. */
export async function loadCoffeeChat(inviteId: string, viewerId: string): Promise<CoffeeChatPage | null> {
  const invite = await prisma.coffeeChatInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, kind: true, senderId: true, recipientId: true, status: true, respondedAt: true },
  });
  const view = invite && coffeeChatViewFor(invite, viewerId);
  if (!view) return null;
  // Looked up from the view's id, never from invite.senderId directly.
  const user = view.otherUserId
    ? await prisma.user.findUnique({
        where: { id: view.otherUserId },
        select: { id: true, firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true, personalEmail: true },
      })
    : null;
  return {
    ...view,
    other: user
      ? {
          id: user.id,
          name: fullName(user) || "Member",
          email: user.daliEmail || user.dartmouthEmail || user.personalEmail || null,
        }
      : null,
  };
}
