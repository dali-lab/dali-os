// MCP `manage_calendar_link` — remove a calendar link or toggle sub-calendar
// visibility. Mirrors the action logic of settings.calendar.tsx.
// Requires `mcp:write` scope (self only — only the link owner can modify it).

import { prisma } from "~/lib/db.server";
import { markCalendarChanged } from "~/calendar/lib/external-cache.server";
import { setSubCalendarEnabled } from "~/calendar/lib/sub-calendar.server";
import { McpNotFoundError, McpInvalidError } from "../../registry";

export const MANAGE_CALENDAR_LINK_DEF = {
  name: "manage_calendar_link",
  description:
    "Remove a connected calendar account link, or toggle a sub-calendar's visibility in the DALI calendar. Use list_my_calendar_links to discover link and calendar IDs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["remove", "toggle_sub_calendar"],
        description:
          "'remove' disconnects the calendar account. 'toggle_sub_calendar' shows/hides a sub-calendar layer.",
      },
      linkId: {
        type: "string",
        minLength: 1,
        description: "UserCalendarLink.id. Use list_my_calendar_links to find this.",
      },
      calendarId: {
        type: "string",
        minLength: 1,
        description: "Sub-calendar ID — required for 'toggle_sub_calendar'.",
      },
      enabled: {
        type: "boolean",
        description:
          "true = show this sub-calendar in DALI; false = hide it. Required for 'toggle_sub_calendar'.",
      },
    },
    required: ["action", "linkId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input =
  | { action: "remove"; linkId: string }
  | { action: "toggle_sub_calendar"; linkId: string; calendarId: string; enabled: boolean };

export async function runManageCalendarLink(userId: string, input: Input) {
  if (input.action === "remove") {
    const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
    if (!link || link.userId !== userId) {
      throw new McpNotFoundError("Calendar link not found");
    }
    await prisma.userCalendarLink.delete({ where: { id: input.linkId } });
    await markCalendarChanged(userId);
    return { ok: true };
  }

  if (input.action === "toggle_sub_calendar") {
    if (!input.calendarId) throw new McpInvalidError("calendarId is required");
    if (input.enabled === undefined) throw new McpInvalidError("enabled is required");

    const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
    if (!link || link.userId !== userId) {
      throw new McpNotFoundError("Calendar link not found");
    }
    await setSubCalendarEnabled(input.linkId, input.calendarId, input.enabled);
    return { ok: true };
  }

  throw new McpInvalidError("Unsupported action");
}
