// MCP tool: manage_education_session — add, update, delete, or bulk-generate
// sessions for an education offering. All mutations route through
// runOfferingAction (same FormData dispatcher as the HTTP routes).
// Access: instructor or Core (isOfferingManager). Scope: mcp:write.

import { runOfferingAction } from "~/education/lib/offerings.server";
import { isOfferingManager } from "~/education/lib/access.server";
import {
  requireForAction,
  McpNotFoundError,
  McpForbiddenError,
  McpInvalidError,
  type McpCtx,
  type McpTool,
} from "../../registry";

export const MANAGE_EDUCATION_SESSION_TOOL = {
  name: "manage_education_session",
  description:
    "Add, update, delete, or bulk-generate sessions for an education offering. Actions: add · update · delete · generate_series. generate_series has two modes: weekday mode (weekdays + startDate + startTime [+ endTime] + weeks) fills every matching class day in date order, or interval mode (startDatetime + count [+ intervalDays]). Sessions are always renumbered chronologically. Instructor or Core only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "update", "delete", "generate_series"],
      },
      offeringId: { type: "string", minLength: 1 },
      sessionId: {
        type: "string",
        description: "Required for update and delete.",
      },
      datetime: {
        type: "string",
        description: "ISO datetime start. Required for add and update.",
      },
      endsAt: {
        type: "string",
        description: "Optional ISO datetime end (add and update). Must be after datetime.",
      },
      title: { type: "string", description: "Optional session title." },
      location: { type: "string", description: "Optional location." },
      notes: { type: "string", description: "Optional notes." },
      recordingUrl: {
        type: "string",
        description: "Optional recording URL (update only).",
      },
      weekdays: {
        type: "array",
        items: { type: "number", minimum: 0, maximum: 6 },
        description:
          "generate_series weekday mode: weekdays to meet on (0=Sunday … 6=Saturday), e.g. [1,3] for Mon/Wed.",
      },
      startDate: {
        type: "string",
        description: "generate_series weekday mode: YYYY-MM-DD the series starts the week of.",
      },
      startTime: {
        type: "string",
        description: "generate_series weekday mode: HH:MM start time for each session.",
      },
      endTime: {
        type: "string",
        description: "generate_series weekday mode: optional HH:MM end time for each session.",
      },
      weeks: {
        type: "number",
        description: "generate_series weekday mode: how many weeks to repeat (max 26, default 1).",
      },
      startDatetime: {
        type: "string",
        description: "generate_series interval mode: ISO datetime of the first session.",
      },
      count: {
        type: "number",
        description: "generate_series interval mode: number of sessions (max 30).",
      },
      intervalDays: {
        type: "number",
        description: "generate_series interval mode: days between sessions (max 30, default 7).",
      },
    },
    required: ["action", "offeringId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Args = {
  action: string;
  offeringId: string;
  sessionId?: string;
  datetime?: string;
  endsAt?: string;
  title?: string;
  location?: string;
  notes?: string;
  recordingUrl?: string;
  weekdays?: number[];
  startDate?: string;
  startTime?: string;
  endTime?: string;
  weeks?: number;
  startDatetime?: string;
  count?: number;
  intervalDays?: number;
};

export async function runManageEducationSession(ctx: McpCtx, args: Args) {
  requireForAction(args.action, args, {
    add: ["datetime"],
    update: ["sessionId", "datetime"],
    delete: ["sessionId"],
    // generate_series validates its two modes server-side (weekday vs interval).
    generate_series: [],
  });

  if (!(await isOfferingManager(ctx.user.id, args.offeringId))) {
    throw new McpForbiddenError();
  }

  const intentMap: Record<string, string> = {
    add: "add-session",
    update: "update-session",
    delete: "delete-session",
    generate_series: "generate-sessions",
  };
  const intent = intentMap[args.action];

  const fd = new FormData();
  fd.set("intent", intent);
  fd.set("offeringId", args.offeringId);

  if (args.sessionId) fd.set("sessionId", args.sessionId);
  if (args.datetime) fd.set("datetime", args.datetime);
  if (args.endsAt !== undefined) fd.set("endsAt", args.endsAt);
  if (args.title !== undefined) fd.set("title", args.title);
  if (args.location !== undefined) fd.set("location", args.location);
  if (args.notes !== undefined) fd.set("notes", args.notes);
  if (args.recordingUrl !== undefined) fd.set("recordingUrl", args.recordingUrl);
  if (args.weekdays) for (const d of args.weekdays) fd.append("weekdays", String(d));
  if (args.startDate) fd.set("startDate", args.startDate);
  if (args.startTime) fd.set("startTime", args.startTime);
  if (args.endTime) fd.set("endTime", args.endTime);
  if (args.weeks !== undefined) fd.set("weeks", String(args.weeks));
  if (args.startDatetime) fd.set("startDatetime", args.startDatetime);
  if (args.count !== undefined) fd.set("count", String(args.count));
  if (args.intervalDays !== undefined) fd.set("intervalDays", String(args.intervalDays));

  const result = await runOfferingAction(fd, ctx.user.id);

  if ("error" in result) {
    if (result.status === 404) throw new McpNotFoundError(result.error);
    throw new McpInvalidError(result.error);
  }

  return { ok: true, id: result.id ?? null };
}

export const MANAGE_EDUCATION_SESSION: McpTool = {
  def: MANAGE_EDUCATION_SESSION_TOOL,
  run: (ctx: McpCtx, args) => runManageEducationSession(ctx, args as Args),
};
