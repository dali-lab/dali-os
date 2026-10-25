// MCP tool area: onboarding journeys. Aggregated into app/mcp/registry.ts.

import type { McpTool } from "../../registry";
import { GET_JOURNEY, LIST_JOURNEYS } from "./read";
import { MANAGE_JOURNEY, MANAGE_JOURNEY_MODULE } from "./manage-journey";
import { MANAGE_JOURNEY_PAGE, MANAGE_JOURNEY_SLIDES, SET_JOURNEY_LAB, SET_JOURNEY_QUIZ } from "./manage-content";
import { MANAGE_JOURNEY_ACCESS } from "./manage-access";
import { MANAGE_JOURNEY_REVIEWS, SET_JOURNEY_STUDIO_LAB } from "./manage-studio";

export const JOURNEYS_TOOLS: McpTool[] = [
  LIST_JOURNEYS,
  GET_JOURNEY,
  MANAGE_JOURNEY,
  MANAGE_JOURNEY_MODULE,
  MANAGE_JOURNEY_PAGE,
  MANAGE_JOURNEY_SLIDES,
  SET_JOURNEY_LAB,
  SET_JOURNEY_QUIZ,
  SET_JOURNEY_STUDIO_LAB,
  MANAGE_JOURNEY_REVIEWS,
  MANAGE_JOURNEY_ACCESS,
];
