import { publish } from "~/lib/realtime-bus.server";

// notify() and the read endpoints (for badge convergence) publish; every open
// notification stream for those users re-fetches its feed.

export const notificationTopic = (userId: string) => `notify:${userId}`;

export function publishNotificationChange(userIds: string[]): void {
  for (const userId of new Set(userIds)) publish(notificationTopic(userId));
}
