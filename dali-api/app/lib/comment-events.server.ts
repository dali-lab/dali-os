import { publish } from "~/lib/realtime-bus.server";

// The comments action (create / edit / resolve / delete) publishes; every open
// comment stream for that page refetches its threads.

export const commentTopic = (pageId: string) => `comments:${pageId}`;

export function publishCommentChange(pageId: string): void {
  publish(commentTopic(pageId));
}
