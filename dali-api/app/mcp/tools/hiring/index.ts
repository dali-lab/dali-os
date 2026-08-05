// MCP tool area: hiring. Aggregated into app/mcp/registry.ts.
// Each tool file here exports McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";

import { LIST_HIRING_CYCLES_TOOL, runListHiringCycles } from "./list-hiring-cycles";
import { GET_HIRING_CYCLE_TOOL, runGetHiringCycle } from "./get-hiring-cycle";
import { LIST_APPLICATIONS_TOOL, runListApplications } from "./list-applications";
import { GET_APPLICATION_TOOL, runGetApplication } from "./get-application";
import { LIST_WAITLIST_TOOL, runListWaitlist } from "./list-waitlist";
import { GET_DELIBS_SESSION_TOOL, runGetDelibsSession } from "./get-delibs-session";

export const HIRING_TOOLS: McpTool[] = [
  {
    def: LIST_HIRING_CYCLES_TOOL,
    run: (ctx, _args) => runListHiringCycles(ctx.user.id),
  },
  {
    def: GET_HIRING_CYCLE_TOOL,
    run: (ctx, args) => runGetHiringCycle(ctx.user.id, args as { cycleId: string }),
  },
  {
    def: LIST_APPLICATIONS_TOOL,
    run: (ctx, args) =>
      runListApplications(ctx.user.id, args as { cycleId: string; domainId?: string; status?: string }),
  },
  {
    def: GET_APPLICATION_TOOL,
    run: (ctx, args) =>
      runGetApplication(ctx.user.id, args as { domainApplicationId: string }),
  },
  {
    def: LIST_WAITLIST_TOOL,
    run: (ctx, args) => runListWaitlist(ctx.user.id, args as { cycleId?: string }),
  },
  {
    def: GET_DELIBS_SESSION_TOOL,
    run: (ctx, args) =>
      runGetDelibsSession(ctx.user.id, args as { delibsSessionId: string }),
  },
];
