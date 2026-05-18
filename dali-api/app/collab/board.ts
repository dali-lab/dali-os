import { presenceRoomName } from "./roomName";

// Realtime task board signal.
//
// Prisma is the source of truth for task state. The board uses a presence
// room (awareness-only, no Y.Doc state) where the *client that performed
// the mutation* sets an awareness field — peers receive the change and
// revalidate their loader data. No server-side broadcaster needed.

export type BoardEventKind =
  | "task.created"
  | "task.updated"
  | "task.deleted"
  | "task.moved"
  | "sprint.created"
  | "sprint.updated"
  | "sprint.closed"
  | "epic.created"
  | "epic.updated";

export interface BoardEvent {
  kind: BoardEventKind;
  projectId: string;
  /** ID of the entity most relevant to the change (taskId/sprintId/epicId). */
  entityId: string;
  /** Timestamp from the originating client. */
  ts: number;
}

/** Hocuspocus room name used for project board awareness. */
export function boardRoomName(projectId: string): string {
  return presenceRoomName(`board:${projectId}`);
}
