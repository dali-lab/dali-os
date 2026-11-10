// MCP tool area: onboarding journeys. Aggregated into app/mcp/registry.ts.

import type { McpTool } from "../../registry";
import { GET_JOURNEY, LIST_JOURNEYS } from "./read";
import { MANAGE_JOURNEY, MANAGE_JOURNEY_MODULE } from "./manage-journey";
import { MANAGE_JOURNEY_PAGE, MANAGE_JOURNEY_SLIDES } from "./manage-content";
import { LIST_JOURNEY_ACCESS, MANAGE_JOURNEY_ACCESS } from "./manage-access";
import { GET_JOURNEY_REVIEW, LIST_JOURNEY_REVIEWS, REVIEW_JOURNEY_SUBMISSION } from "./manage-studio";
import { SET_JOURNEY_ACTIVITY } from "./activity";

export const JOURNEYS_TOOLS: McpTool[] = [
  LIST_JOURNEYS,
  GET_JOURNEY,
  MANAGE_JOURNEY,
  MANAGE_JOURNEY_MODULE,
  MANAGE_JOURNEY_PAGE,
  MANAGE_JOURNEY_SLIDES,
  SET_JOURNEY_ACTIVITY,
  LIST_JOURNEY_REVIEWS,
  GET_JOURNEY_REVIEW,
  REVIEW_JOURNEY_SUBMISSION,
  LIST_JOURNEY_ACCESS,
  MANAGE_JOURNEY_ACCESS,
];
