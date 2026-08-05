// MCP tool area: faceted. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";
import { MANAGE_SPRINT_TOOL } from "./manage-sprint";
import { MANAGE_EPIC_TOOL } from "./manage-epic";
import { MANAGE_STORY_TOOL } from "./manage-story";
import { MANAGE_TIME_ENTRY_TOOL } from "./manage-time-entry";
import { MANAGE_MANUAL_BLOCK_TOOL } from "./manage-manual-block";
import { MANAGE_DOCUMENT_SHARING_TOOL } from "./manage-document-sharing";

export const FACETED_TOOLS: McpTool[] = [
  MANAGE_SPRINT_TOOL,
  MANAGE_EPIC_TOOL,
  MANAGE_STORY_TOOL,
  MANAGE_TIME_ENTRY_TOOL,
  MANAGE_MANUAL_BLOCK_TOOL,
  MANAGE_DOCUMENT_SHARING_TOOL,
];
