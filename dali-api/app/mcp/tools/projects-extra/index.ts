// MCP tool area: projects-extra. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";

import { UPDATE_PROJECT_TOOL, runUpdateProject } from "./update-project";
import { MANAGE_TASK_FILES_TOOL, runManageTaskFiles } from "./manage-task-files";
import { SET_PAGE_VISIBILITY_TOOL, runSetPageVisibility } from "./set-page-visibility";
import { SET_FILE_PARTNER_VISIBILITY_TOOL, runSetFilePartnerVisibility } from "./set-file-partner-visibility";
import { MANAGE_STAFFING_TOOL, runManageStaffing } from "./manage-staffing";
import { FINALIZE_STAFFING_TOOL, runFinalizeStaffing } from "./finalize-staffing";
import { CORRECT_ASSIGNMENT_LEVEL_TOOL, runCorrectAssignmentLevel } from "./correct-assignment-level";

export const PROJECTS_EXTRA_TOOLS: McpTool[] = [
  {
    def: UPDATE_PROJECT_TOOL,
    run: (ctx, args) => runUpdateProject(ctx.user.id, args as any),
  },
  {
    def: MANAGE_TASK_FILES_TOOL,
    run: (ctx, args) => runManageTaskFiles(ctx.user.id, args as any),
  },
  {
    def: SET_PAGE_VISIBILITY_TOOL,
    run: (ctx, args) => runSetPageVisibility(ctx.user.id, args as any),
  },
  {
    def: SET_FILE_PARTNER_VISIBILITY_TOOL,
    run: (ctx, args) => runSetFilePartnerVisibility(ctx.user.id, args as any),
  },
  {
    def: MANAGE_STAFFING_TOOL,
    run: (ctx, args) => runManageStaffing(ctx.user.id, args as any),
  },
  {
    def: FINALIZE_STAFFING_TOOL,
    run: (ctx, args) => runFinalizeStaffing(ctx.user.id, args as any),
  },
  {
    def: CORRECT_ASSIGNMENT_LEVEL_TOOL,
    run: (ctx, args) => runCorrectAssignmentLevel(ctx.user.id, args as any),
  },
];
