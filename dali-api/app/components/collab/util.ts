// Shared helpers and types used by the collaborative editor and the
// page-level presence layer.

export { initialsFromName } from "~/lib/display";

export const IDLE_AFTER_MS = 30_000;
export const ACTIVITY_THROTTLE_MS = 2_000;
export const IDLE_CHECK_MS = 5_000;

/** Deterministic pleasant color from a user name. */
export function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/** Resolve the collab WebSocket URL injected into window by root.tsx. */
export function getCollabUrl(): string {
  if (typeof window === "undefined") return "";
  const url = (window as any).__COLLAB_URL;
  return url && url.length > 0 ? url : "ws://localhost:3002";
}

/** Shape of the `user` field broadcast over awareness. */
export interface AwarenessUser {
  name: string;
  color: string;
  lastActive: number;
  idle?: boolean;
  /**
   * Set by the editor on focus. Used by the page-level presence bar to know
   * which editor's `followPeer` to invoke when an avatar is clicked. Sticky
   * across blur — peer remains associated with their last-focused editor.
   */
  currentEditor?: string;
}
