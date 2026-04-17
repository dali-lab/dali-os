/**
 * Naming for collaborative rooms. Used by both the client (PresenceProvider,
 * CollaborativeEditor) and the server (persistence) so the prefix and shape
 * stay in sync.
 *
 * Naming conventions:
 *   review:{reviewId}:feedback
 *   review:{reviewId}:rejectionRationale
 *   interview:{interviewId}:notes
 *   interview:{interviewId}:recommendation
 *   presence:{pageId}                  ephemeral, no persistence
 */

export const PRESENCE_ROOM_PREFIX = "presence:";

export function presenceRoomName(pageId: string): string {
  return `${PRESENCE_ROOM_PREFIX}${pageId}`;
}

export function isPresenceRoom(name: string): boolean {
  return name.startsWith(PRESENCE_ROOM_PREFIX);
}
