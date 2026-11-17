import { prisma } from "~/lib/db.server";
import { notify } from "~/lib/notify.server";
import { partnerNotifyRecipients } from "~/partners/lib/partner-notify.server";

export const MAX_HISTORY_NOTE = 1000;

export async function reportHistoryCorrection(userId: string, note: string): Promise<boolean> {
  const text = note.trim().slice(0, MAX_HISTORY_NOTE);
  if (text === "") return false;
  const [user, recipients] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    partnerNotifyRecipients(),
  ]);
  if (recipients.length === 0) return false;
  const name = `${user.firstName} ${user.lastName}`.trim();
  await notify({
    eventType: "alumni.history_correction",
    createdByUserId: userId,
    message: {
      title: `${name} reported a fix to their DALI history`,
      body: text,
      link: `/members/${userId}`,
    },
    recipients: recipients.map((id) => ({ userId: id })),
  });
  return true;
}
