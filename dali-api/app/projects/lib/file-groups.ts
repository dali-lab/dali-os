// Pure grouping for the project Files block: work files cluster under the
// epic their linked tasks belong to. Organization is derived from
// TaskFileLink → Task.epicId rather than managed folders, so it can't go
// stale — re-epic a task and its files follow.

export type GroupableFile = {
  id: string;
  taskLinked: boolean;
  epicIds: string[];
};

export type FileEpicGroups<F extends GroupableFile> = {
  // One group per epic that has work files, in the caller's epic order.
  epicGroups: { id: string; title: string; files: F[] }[];
  // Task-linked files whose tasks carry no epic.
  otherWorkFiles: F[];
  // Files not linked to any task — the plain uploads list.
  generalFiles: F[];
};

export function groupFilesByEpic<F extends GroupableFile>(
  files: F[],
  epics: { id: string; title: string }[],
): FileEpicGroups<F> {
  const byEpic = new Map<string, F[]>();
  const otherWorkFiles: F[] = [];
  const generalFiles: F[] = [];

  for (const f of files) {
    if (!f.taskLinked) {
      generalFiles.push(f);
      continue;
    }
    if (f.epicIds.length === 0) {
      otherWorkFiles.push(f);
      continue;
    }
    // A file linked to tasks in several epics appears under each — rare, and
    // truer than picking one.
    for (const epicId of f.epicIds) {
      const list = byEpic.get(epicId);
      if (list) list.push(f);
      else byEpic.set(epicId, [f]);
    }
  }

  // An epicId missing from the caller's list shouldn't happen (epics are
  // project-scoped), but fall back to the epicless bucket so nothing vanishes.
  const known = new Set(epics.map((e) => e.id));
  for (const [epicId, list] of byEpic) {
    if (!known.has(epicId)) otherWorkFiles.push(...list);
  }

  return {
    epicGroups: epics
      .filter((e) => byEpic.has(e.id))
      .map((e) => ({ id: e.id, title: e.title, files: byEpic.get(e.id)! })),
    otherWorkFiles,
    generalFiles,
  };
}
