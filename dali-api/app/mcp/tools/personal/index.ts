// MCP tool area: personal — cross-cutting member self-service that doesn't
// belong to a product area (notifications extras, profile-directory, onboarding,
// presence). Aggregated into app/mcp/registry.ts. Each tool file here exports
// McpTool entries; list them in the array below.

import type { McpTool } from "../../registry";

import {
  LIST_MEMBERS_DEF,
  runListMembers,
} from "./list-members";
import {
  COMPLETE_ONBOARDING_TOUR_DEF,
  runCompleteOnboardingTour,
} from "./complete-onboarding-tour";
import {
  SET_ACTIVITY_VISIBILITY_DEF,
  runSetActivityVisibility,
} from "./set-activity-visibility";

export const PERSONAL_TOOLS: McpTool[] = [
  {
    def: LIST_MEMBERS_DEF,
    run: (_ctx, args) =>
      runListMembers(args as Parameters<typeof runListMembers>[0]),
  },
  {
    def: COMPLETE_ONBOARDING_TOUR_DEF,
    run: (ctx) => runCompleteOnboardingTour(ctx.user.id),
  },
  {
    def: SET_ACTIVITY_VISIBILITY_DEF,
    run: (ctx, args) =>
      runSetActivityVisibility(ctx.user.id, args as Parameters<typeof runSetActivityVisibility>[1]),
  },
];
