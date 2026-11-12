// MCP `enhance_meeting_notes`: adapts the MCP context to enhanceMeetingNotes
// (calendar/lib/enhance-meeting-notes.server.ts), which web-independent callers share.

import { enhanceMeetingNotes } from "~/calendar/lib/enhance-meeting-notes.server";
import type { McpCtx } from "../../registry";

export const ENHANCE_MEETING_NOTES_DEF = {
  name: "enhance_meeting_notes",
  description:
    "Preview or apply Enhance for a finished meeting recording (specs/meeting-notes-model.md §2): merges the transcript into the note's typed blocks, citing the moments it drew from, and files Decisions the author missed, and lists action items as suggested tasks under a Tasks heading. Preview (apply omitted/false) regenerates the plan and returns it, verified against the real transcript — call this first. Apply (apply: true) merges the most recently previewed plan into the live note and marks it enhanced; it fails with a 409-equivalent error if someone else re-previewed after you did, meaning you should preview again before retrying. Requires edit access to the note, same as the Enhance button.",
  inputSchema: {
    type: "object" as const,
    properties: {
      recordingId: { type: "string", minLength: 1, description: "MeetingRecording.id." },
      apply: {
        type: "boolean",
        description: "true to merge the previewed plan into the note. Defaults to false (preview only).",
      },
    },
    required: ["recordingId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { recordingId: string; apply?: boolean };

export async function runEnhanceMeetingNotes(ctx: McpCtx, input: Input) {
  return enhanceMeetingNotes({ user: ctx.user, request: ctx.request }, input);
}
