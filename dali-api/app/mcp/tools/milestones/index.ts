import type { McpTool } from "../../registry";
import { LIST_MILESTONE_SETS_TOOL } from "./list-milestone-sets";
import { MANAGE_MILESTONE_SET_TOOL } from "./manage-milestone-set";

export const MILESTONES_TOOLS: McpTool[] = [
  LIST_MILESTONE_SETS_TOOL,
  MANAGE_MILESTONE_SET_TOOL,
];
