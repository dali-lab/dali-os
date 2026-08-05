// MCP tool area: mentorship. Aggregated into app/mcp/registry.ts.
// Visibility contract: mentor notes and pairs are mentor/Core only — mentees
// are NEVER granted access. Enforced in every tool's run() via canViewMentorship
// and per-note canViewMentorNote checks.

import type { McpTool } from "../../registry";
import { LIST_MENTOR_NOTES } from "./list-mentor-notes";
import { GET_MENTOR_NOTE } from "./get-mentor-note";
import { LIST_MENTORSHIP_PAIRS } from "./list-mentorship-pairs";
import { LIST_MENTOR_NOTE_TEMPLATES } from "./list-mentor-note-templates";
import { MANAGE_MENTOR_NOTE } from "./manage-mentor-note";
import { MANAGE_MENTORSHIP_PAIR } from "./manage-mentorship-pair";
import { MANAGE_MENTOR_NOTE_TEMPLATE } from "./manage-mentor-note-template";

export const MENTORSHIP_TOOLS: McpTool[] = [
  LIST_MENTOR_NOTES,
  GET_MENTOR_NOTE,
  LIST_MENTORSHIP_PAIRS,
  LIST_MENTOR_NOTE_TEMPLATES,
  MANAGE_MENTOR_NOTE,
  MANAGE_MENTORSHIP_PAIR,
  MANAGE_MENTOR_NOTE_TEMPLATE,
];
