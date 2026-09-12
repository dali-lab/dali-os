// MCP `manage_calendar_link` — remove a calendar link or toggle sub-calendar
// visibility. Mirrors the action logic of settings.calendar.tsx.
// Requires `mcp:write` scope (self only — only the link owner can modify it).

import { prisma } from "~/lib/db";
import { McpNotFoundError, McpInvalidError } from "../../registry";

export const MANAGE_CALENDAR_LINK_DEF = {
  name: "manage_calendar_link",
  description:
    "Remove a connected calendar account link, or toggle a sub-calendar's visibility in the DALI calendar. Use list_my_calendar_links to discover link and calendar IDs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      intent: {
        type: "string",
        enum: ["remove-calendar-link", "toggle-sub-calendar"],
        description:
          "'remove-calendar-link' disconnects the calendar account. 'toggle-sub-calendar' shows/hides a sub-calendar layer.",
      },
      linkId: {
        type: "string",
        minLength: 1,
        description: "UserCalendarLink.id. Use list_my_calendar_links to find this.",
      },
      calendarId: {
        type: "string",
        minLength: 1,
        description: "Sub-calendar ID — required for 'toggle-sub-calendar'.",
      },
      enabled: {
        type: "boolean",
        description:
          "true = show this sub-calendar in DALI; false = hide it. Required for 'toggle-sub-calendar'.",
      },
    },
    required: ["intent", "linkId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input =
  | { intent: "remove-calendar-link"; linkId: string }
  | { intent: "toggle-sub-calendar"; linkId: string; calendarId: string; enabled: boolean };

export async function runManageCalendarLink(userId: string, input: Input) {
  if (input.intent === "remove-calendar-link") {
    const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
    if (!link || link.userId !== userId) {
      throw new McpNotFoundError("Calendar link not found");
    }
    await prisma.userCalendarLink.delete({ where: { id: input.linkId } });
    return { ok: true };
  }

  if (input.intent === "toggle-sub-calendar") {
    if (!input.calendarId) throw new McpInvalidError("calendarId is required");
    if (input.enabled === undefined) throw new McpInvalidError("enabled is required");

    const link = await prisma.userCalendarLink.findUnique({ where: { id: input.linkId } });
    if (!link || link.userId !== userId) {
      throw new McpNotFoundError("Calendar link not found");
    }
    const current = new Set(link.subCalendarIds);
    if (input.enabled) current.add(input.calendarId);
    else current.delete(input.calendarId);
    await prisma.userCalendarLink.update({
      where: { id: input.linkId },
      data: { subCalendarIds: Array.from(current) },
    });
    return { ok: true };
  }

  throw new McpInvalidError("Unsupported intent");
}
