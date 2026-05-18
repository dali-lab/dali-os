// MCP `list_my_calendar_links` — list the authenticated user's linked external
// calendars (Google, etc.). Provides the `id` needed for the
// `organizerCalendarLinkId` parameter on `schedule_meeting`. Requires the
// `mcp:read` scope.

import { prisma } from "~/lib/db";

export const LIST_MY_CALENDAR_LINKS_TOOL = {
  name: "list_my_calendar_links",
  description:
    "List the authenticated user's linked external calendars. Use the returned `id` as `organizerCalendarLinkId` on `schedule_meeting` to push the meeting to that calendar (and send Gmail invites). Includes disabled / errored links so the agent can surface broken connections.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type CalendarLinkOut = {
  id: string;
  provider: string;
  externalEmail: string;
  displayName: string | null;
  primary: boolean;
  enabled: boolean;
  hasSyncError: boolean;
  linkedAt: string;
  lastSyncedAt: string | null;
};

export async function runListMyCalendarLinks(userId: string) {
  const links = await prisma.userCalendarLink.findMany({
    where: { userId },
    orderBy: { linkedAt: "asc" },
    select: {
      id: true,
      provider: true,
      externalEmail: true,
      displayName: true,
      primary: true,
      enabled: true,
      syncError: true,
      linkedAt: true,
      lastSyncedAt: true,
    },
  });

  const out: CalendarLinkOut[] = links.map((l) => ({
    id: l.id,
    provider: l.provider,
    externalEmail: l.externalEmail,
    displayName: l.displayName,
    primary: l.primary,
    enabled: l.enabled,
    hasSyncError: l.syncError !== null,
    linkedAt: l.linkedAt.toISOString(),
    lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
  }));

  return { links: out };
}
