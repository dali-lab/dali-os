// MCP `manage_class` — add, update, or delete a Dartmouth class for the
// authenticated user. Reuses createClass / updateClass / removeClass from
// ~/lib/member-class.server. Requires `mcp:write` scope (self only).

import {
  createClass,
  updateClass,
  removeClass,
  parseDestination,
  MemberClassError,
} from "~/lib/member-class.server";
import { McpInvalidError, McpNotFoundError } from "../../registry";

export const MANAGE_CLASS_DEF = {
  name: "manage_class",
  description:
    "Add, update, or delete a Dartmouth class for yourself. Classes appear in the DALI calendar. Use 'add' or 'update' with a periodCode (e.g. '2A') for scheduled classes, or omit it and provide customMeetings for irregular schedules. The destination controls where events live — use 'local' for DALI-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      intent: {
        type: "string",
        enum: ["add", "update", "delete"],
        description: "Operation to perform.",
      },
      classId: {
        type: "string",
        minLength: 1,
        description: "MemberClass.id — required for 'update' and 'delete'.",
      },
      termId: {
        type: "string",
        minLength: 1,
        description: "Term.id for the class — required for 'add' and 'update'.",
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Course title — required for 'add' and 'update'.",
      },
      location: {
        type: "string",
        maxLength: 200,
        description: "Classroom or location string (optional).",
      },
      periodCode: {
        type: "string",
        maxLength: 10,
        description:
          "Dartmouth period code (e.g. '2A', '10'). Either periodCode OR customMeetings must be provided for add/update.",
      },
      includeXHour: {
        type: "boolean",
        description: "Include the x-hour meeting for this period (default false).",
      },
      customMeetings: {
        type: "array",
        description:
          "Custom meeting schedule when periodCode is not used. Each item: days (weekday numbers this pattern meets, 0=Sun…6=Sat), startMin and endMin (minutes from local midnight, e.g. 9:30am = 570).",
        items: {
          type: "object",
          properties: {
            days: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 6 },
            },
            startMin: { type: "integer", minimum: 0, maximum: 1439 },
            endMin: { type: "integer", minimum: 0, maximum: 1439 },
          },
          required: ["days", "startMin", "endMin"],
          additionalProperties: false,
        },
      },
      destination: {
        type: "string",
        description:
          "Where to store the class events. 'local' = DALI-only layer; 'google-dedicated:<linkId>' = dedicated Classes calendar on a Google account; 'google-primary:<linkId>' = primary calendar; 'google-calendar:<linkId>:<calendarId>' = specific sub-calendar. Use list_my_calendar_links to find linkIds.",
      },
      // Timetable provenance (optional — populated by search_timetable_courses)
      offeringCrn: {
        type: "string",
        description: "CourseOffering CRN from the timetable (optional).",
      },
      subject: {
        type: "string",
        description: "Subject code, e.g. 'COSC' (optional).",
      },
      courseNumber: {
        type: "string",
        description: "Course number, e.g. '89' (optional).",
      },
      section: {
        type: "string",
        description: "Section identifier, e.g. '01' (optional).",
      },
    },
    required: ["intent"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type CustomMeeting = {
  days: number[];
  startMin: number;
  endMin: number;
};

type Input = {
  intent: "add" | "update" | "delete";
  classId?: string;
  termId?: string;
  title?: string;
  location?: string;
  periodCode?: string;
  includeXHour?: boolean;
  customMeetings?: CustomMeeting[];
  destination?: string;
  offeringCrn?: string;
  subject?: string;
  courseNumber?: string;
  section?: string;
};

export async function runManageClass(userId: string, input: Input) {
  try {
    if (input.intent === "delete") {
      if (!input.classId) throw new McpInvalidError("classId is required for delete");
      await removeClass(userId, input.classId);
      return { ok: true };
    }

    // add or update
    if (!input.termId) throw new McpInvalidError("termId is required");
    if (!input.title) throw new McpInvalidError("title is required");
    if (!input.destination) throw new McpInvalidError("destination is required");
    if (!input.periodCode && (!input.customMeetings || input.customMeetings.length === 0)) {
      throw new McpInvalidError("Either periodCode or customMeetings must be provided");
    }

    const destination = parseDestination(input.destination);

    const classInput = {
      userId,
      termId: input.termId,
      title: input.title,
      location: input.location ?? null,
      periodCode: input.periodCode ?? null,
      includeXHour: input.includeXHour ?? false,
      customMeetings: input.customMeetings?.map((m) => ({
        kind: "main" as const,
        days: m.days,
        startMin: m.startMin,
        endMin: m.endMin,
      })),
      destination,
      offeringCrn: input.offeringCrn ?? null,
      subject: input.subject ?? null,
      courseNumber: input.courseNumber ?? null,
      section: input.section ?? null,
    };

    if (input.intent === "add") {
      await createClass(classInput);
      return { ok: true };
    } else {
      // update
      if (!input.classId) throw new McpInvalidError("classId is required for update");
      await updateClass(input.classId, classInput);
      return { ok: true };
    }
  } catch (err) {
    if (err instanceof McpInvalidError || err instanceof McpNotFoundError) throw err;
    // MemberClassError covers bad schedule, destination, and term-not-found from the class helpers.
    if (err instanceof Error && (err instanceof MemberClassError || err.name === "MemberClassError")) {
      throw new McpInvalidError(err.message);
    }
    throw err;
  }
}
