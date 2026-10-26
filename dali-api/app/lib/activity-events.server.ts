import { publish } from "~/lib/realtime-bus.server";

// Live activity surfaces (specs/activities.md §7.6): a code submit or hint
// reveal publishes, and every open surface refetches its leaderboard.

export const activityTopic = (activityId: string) => `activity:${activityId}`;

export function publishActivityChange(activityId: string): void {
  publish(activityTopic(activityId));
}
