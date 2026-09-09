// Server-side mechanic registry (specs/activities.md §5). Keyed by Activity.kind.
// Holds the behavior a mechanic needs server-side: config validation, the
// route-filtered overlay payload, the member action handler, and the
// progress/results computation. The mirrored CLIENT registry (registry.ts)
// holds the React pieces. Keep the two apart — importing a server handler into
// a client module crashes the client bundle.

import type { Activity, ActivityEvent } from "~/generated/prisma/client";
import { scavengerHuntServer } from "./scavenger-hunt.server";

export type ActionOutcome = {
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
};

export type SummarizeArgs = {
  activity: Activity;
  userId: string;
  viewerIsCore: boolean;
  userEvents: ActivityEvent[];
  allEvents: ActivityEvent[];
};

export type MechanicServer = {
  kind: string;
  /** Validate + normalize config on write; throws on invalid input. */
  parseConfig(input: unknown): unknown;
  /** Route-filtered, safe-to-send overlay payload (never leaks other routes). */
  overlayPayload(activity: Activity, pathname: string): unknown;
  /** Handle a member action on the activity surface. */
  onAction(args: {
    activity: Activity;
    userId: string;
    input: Record<string, unknown>;
  }): Promise<ActionOutcome>;
  /** Compute what the surface renders: per-user progress + (optional) results. */
  summarize(args: SummarizeArgs): { progress: unknown; results: unknown };
};

const MECHANICS: Record<string, MechanicServer> = {
  [scavengerHuntServer.kind]: scavengerHuntServer,
};

export function mechanicServer(kind: string): MechanicServer | undefined {
  return MECHANICS[kind];
}
