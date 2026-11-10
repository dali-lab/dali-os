import { useEffect, useState } from "react";
import type { TaskStatus } from "~/projects/lib/task-board";

export type TaskProject = { id: string; name: string };
export type TaskPerson = { userId: string; name: string };

async function failure(res: Response | null, fallback: string): Promise<Error> {
  const body = (await res?.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? fallback);
}

function send(url: string, method: string, body: unknown): Promise<Response | null> {
  return fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

/** Task dates are date-only values stored as UTC midnight. */
export function dueDateToIso(date: string): string | null {
  return date ? `${date}T00:00:00.000Z` : null;
}

export function dueIsoToDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export async function createTask(input: {
  projectId: string;
  title: string;
  status: TaskStatus;
  dueDate: string;
}): Promise<{ id: string }> {
  const res = await send(`/api/projects/${encodeURIComponent(input.projectId)}/tasks`, "POST", {
    title: input.title,
    status: input.status,
    dueAt: dueDateToIso(input.dueDate),
  });
  if (!res?.ok) throw await failure(res, "Couldn't add the task.");
  return (await res.json()) as { id: string };
}

export async function patchTask(taskId: string, patch: { assigneeIds?: string[]; dueAt?: string | null }): Promise<void> {
  const res = await send(`/api/tasks/${encodeURIComponent(taskId)}`, "PATCH", patch);
  if (!res?.ok) throw await failure(res, "Couldn't save the task.");
}

export async function moveTask(taskId: string, status: TaskStatus): Promise<void> {
  const res = await send(`/api/tasks/${encodeURIComponent(taskId)}/move`, "POST", { status });
  if (!res?.ok) throw await failure(res, "Couldn't change the status.");
}

async function getJson<T>(url: string, pick: (json: never) => T, fallback: T): Promise<T> {
  const res = await fetch(url, { credentials: "include" }).catch(() => null);
  if (!res?.ok) return fallback;
  return pick((await res.json()) as never);
}

const NO_PROJECTS: TaskProject[] = [];
const NO_PEOPLE: TaskPerson[] = [];

/** Projects the viewer can add tasks to. Empty until loaded, or while off. */
export function useTaskProjects(enabled: boolean): TaskProject[] {
  const [projects, setProjects] = useState(NO_PROJECTS);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void getJson("/api/task-options", (json: { projects: TaskProject[] }) => json.projects, NO_PROJECTS).then((next) => {
      if (active) setProjects(next);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return enabled ? projects : NO_PROJECTS;
}

const teams = new Map<string, Promise<TaskPerson[]>>();

function loadTeam(projectId: string): Promise<TaskPerson[]> {
  const known = teams.get(projectId);
  if (known) return known;
  const load = getJson(
    `/api/task-options?projectId=${encodeURIComponent(projectId)}`,
    (json: { members: TaskPerson[] }) => json.members,
    NO_PEOPLE,
  );
  teams.set(projectId, load);
  void load.then((people) => {
    if (people === NO_PEOPLE) teams.delete(projectId);
  });
  return load;
}

/** A project's assignable team, shared by every block on the same project. */
export function useProjectTeam(projectId: string | null): TaskPerson[] {
  const [team, setTeam] = useState<{ projectId: string; people: TaskPerson[] } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void loadTeam(projectId).then((people) => {
      if (active) setTeam({ projectId, people });
    });
    return () => {
      active = false;
    };
  }, [projectId]);
  return team && team.projectId === projectId ? team.people : NO_PEOPLE;
}
