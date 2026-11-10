import type { McpTool } from "../registry";
import { READ_HELP_TOOL, runReadHelp } from "./read-help";

export const HELP_TOOLS: McpTool[] = [
  { def: READ_HELP_TOOL, run: (ctx, args) => runReadHelp(ctx, args as { slug?: string }) },
];
