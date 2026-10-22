import { prisma } from "~/lib/db";

/**
 * Enable or disable one sub-calendar on a link. A single UPDATE, so two quick
 * toggles can't overwrite each other the way a read-modify-write of the array
 * would. The caller checks the link belongs to the user.
 */
export async function setSubCalendarEnabled(
  linkId: string,
  calendarId: string,
  enabled: boolean,
): Promise<void> {
  if (enabled) {
    await prisma.$executeRaw`
      UPDATE "UserCalendarLink"
      SET "subCalendarIds" = array_append("subCalendarIds", ${calendarId})
      WHERE "id" = ${linkId} AND NOT (${calendarId} = ANY("subCalendarIds"))`;
  } else {
    await prisma.$executeRaw`
      UPDATE "UserCalendarLink"
      SET "subCalendarIds" = array_remove("subCalendarIds", ${calendarId})
      WHERE "id" = ${linkId}`;
  }
}
