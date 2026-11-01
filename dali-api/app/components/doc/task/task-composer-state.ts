import type { TaskStatus } from "~/projects/lib/task-board";
import type { TaskProject } from "./task-api";

export type TaskBlockConfig = { projectId: string | null; projects: TaskProject[] };

/** Whether a doc offers "/task". Project docs need access to that project;
 *  any other doc needs at least one project to file the task on. */
export function taskBlockConfig(projects: TaskProject[], docProjectId: string | null): TaskBlockConfig | null {
  if (docProjectId) {
    return projects.some((p) => p.id === docProjectId) ? { projectId: docProjectId, projects } : null;
  }
  return projects.length > 0 ? { projectId: null, projects } : null;
}

/** Tasks outside Backlog need a deadline, so an undated draft starts there and
 *  moves to To do once dated. A status the author picked always wins. */
export function composerStatus(picked: TaskStatus | null, dueDate: string): TaskStatus {
  return picked ?? (dueDate ? "Todo" : "Backlog");
}

export function composerNeedsDate(status: TaskStatus, dueDate: string): boolean {
  return status !== "Backlog" && !dueDate;
}

export function composerCanSubmit(draft: {
  title: string;
  projectId: string | null;
  status: TaskStatus;
  dueDate: string;
}): boolean {
  return Boolean(draft.title.trim() && draft.projectId) && !composerNeedsDate(draft.status, draft.dueDate);
}
