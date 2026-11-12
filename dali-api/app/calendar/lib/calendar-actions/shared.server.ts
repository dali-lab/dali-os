import { prisma } from "~/lib/db.server";
import type { CalendarAction } from "~/lib/calendar-schemas";

export type CalendarActionContext = {
  request: Request;
  userId: string;
  raw: Record<string, FormDataEntryValue>;
};

export type CalendarIntentInput<K extends CalendarAction["intent"]> = Extract<CalendarAction, { intent: K }>;

export async function assertLinkOwned(userId: string, linkId: string): Promise<void> {
  const link = await prisma.userCalendarLink.findFirst({
    where: { id: linkId, userId, provider: "Google" },
    select: { id: true },
  });
  if (!link) throw new Error("That calendar isn't connected to your account.");
}
