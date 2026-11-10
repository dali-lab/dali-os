import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTaskProjects, type TaskProject } from "~/components/doc/task/task-api";
import { composerNeedsDate, composerStatus, taskBlockConfig } from "~/components/doc/task/task-composer-state";
import type { TaskStatus } from "~/projects/lib/task-board";
import { actionItemMatchesBlock, findSuggestionLines, type EnhanceActionItem, type SnapshotBlock } from "./enhance-plan";
import type { RosterUser } from "./types";
import type { UseMeetingRecording } from "./use-meeting-recording";

export const SUCCESS_VISIBLE_MS = 4000;
const NO_ITEMS: EnhanceActionItem[] = [];

export type ActionItemRow = {
  ownerUserId: string;
  ownerName: string;
  dueAt: string;
  status: TaskStatus;
  projectId: string;
};

type RowEdit = Partial<Omit<ActionItemRow, "status">> & { status?: TaskStatus | null };

export type ActionItemDraft = {
  items: EnhanceActionItem[];
  rowFor: (index: number) => ActionItemRow;
  setRow: (index: number, patch: RowEdit) => void;
  roster: RosterUser[];
  projects: TaskProject[];
  needsProject: boolean;
  editable: boolean;
  projectId: string | null;
  lineFor: (index: number) => SnapshotBlock | null;
  needsDate: (index: number) => boolean;
  canAdd: (index: number) => boolean;
  untaskedCount: number;
  addableCount: number;
  stepVisible: boolean;
  dismiss: () => void;
  dismissLine: (index: number) => void;
  busy: boolean;
  created: number | null;
  boardProjectId: string | null;
  create: () => Promise<void>;
  createOne: (index: number) => Promise<void>;
};

const DraftContext = createContext<ActionItemDraft | null>(null);

export function useActionItemDraft(): ActionItemDraft | null {
  return useContext(DraftContext);
}

function liveBlocks(rec: Pick<UseMeetingRecording, "getNoteState">): SnapshotBlock[] | null {
  return rec.getNoteState?.()?.blocks ?? null;
}

function isPresent(item: EnhanceActionItem, line: SnapshotBlock | null, blocks: SnapshotBlock[]): boolean {
  return (
    line !== null ||
    blocks.some((b) => b.type === "task" && actionItemMatchesBlock(item.text, b.text))
  );
}

/** True when ⌘Z took Enhance's writing back out: the note was never reviewed
 *  and none of the plan's action items is a suggestion line, task block or
 *  task any more. */
export function enhanceWasUndone(rec: Pick<UseMeetingRecording, "getNoteState" | "reviewedAt" | "enhanceNotes">): boolean {
  const blocks = liveBlocks(rec);
  if (blocks === null || rec.reviewedAt) return false;
  const items = rec.enhanceNotes?.plan.actionItems ?? NO_ITEMS;
  if (items.length === 0) return false;
  const lines = findSuggestionLines(blocks, items);
  return !items.some((item, i) => item.taskId || isPresent(item, lines[i]!, blocks));
}

function seedRow(item: EnhanceActionItem): Pick<ActionItemRow, "ownerUserId" | "ownerName" | "dueAt"> {
  return { ownerUserId: item.ownerUserId ?? "", ownerName: item.ownerName ?? "", dueAt: item.due ?? "" };
}

function dismissKey(recordingId: string | null, snapshotAt: string): string {
  return `enhance-tasks-dismissed:${recordingId ?? ""}:${snapshotAt}`;
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {}
}

export function ActionItemDraftProvider({ rec, children }: { rec: UseMeetingRecording; children: ReactNode }) {
  const notes = rec.enhanceNotes;
  const snapshotAt = notes?.snapshotAt ?? null;
  const items = notes?.plan.actionItems ?? NO_ITEMS;

  const [edits, setEdits] = useState<{ snapshotAt: string | null; rows: Record<number, RowEdit> }>({
    snapshotAt,
    rows: {},
  });
  const rows = edits.snapshotAt === snapshotAt ? edits.rows : {};
  const [dismissedKeys, setDismissedKeys] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ count: number; projectId: string | null } | null>(null);

  const key = snapshotAt ? dismissKey(rec.recordingId, snapshotAt) : null;
  const dismissed = key ? Boolean(dismissedKeys[key]) || readDismissed(key) : false;

  const projects = useTaskProjects(rec.canEdit);
  const editable = rec.canEdit && taskBlockConfig(projects, rec.projectId) !== null;
  const needsProject = !rec.projectId;
  const soleProject = projects.length === 1 ? projects[0]!.id : "";

  const rowFor = useCallback(
    (index: number): ActionItemRow => {
      const item = items[index];
      const edit = rows[index];
      const base = item ? seedRow(item) : { ownerUserId: "", ownerName: "", dueAt: "" };
      const merged = { ...base, ...edit };
      return {
        ownerUserId: merged.ownerUserId,
        ownerName: merged.ownerName,
        dueAt: merged.dueAt,
        status: composerStatus(edit?.status ?? null, merged.dueAt),
        projectId: rec.projectId ?? edit?.projectId ?? soleProject,
      };
    },
    [items, rows, rec.projectId, soleProject],
  );

  const setRow = useCallback(
    (index: number, patch: RowEdit) => {
      setEdits((prev) => {
        const base = prev.snapshotAt === snapshotAt ? prev.rows : {};
        return { snapshotAt, rows: { ...base, [index]: { ...base[index], ...patch } } };
      });
    },
    [snapshotAt],
  );

  const dismiss = useCallback(() => {
    if (!key) return;
    writeDismissed(key);
    setDismissedKeys((prev) => ({ ...prev, [key]: true }));
  }, [key]);

  const blocks = liveBlocks(rec);
  const lines = blocks ? findSuggestionLines(blocks, items) : items.map(() => null);
  const lineFor = useCallback((index: number) => lines[index] ?? null, [lines]);
  const needsDate = useCallback((index: number) => {
    const r = rowFor(index);
    return composerNeedsDate(r.status, r.dueAt);
  }, [rowFor]);
  const canAdd = useCallback(
    (index: number) => Boolean(lines[index]) && !items[index]?.taskId && !needsDate(index) && Boolean(rowFor(index).projectId),
    [lines, items, needsDate, rowFor],
  );

  const untasked = items.map((item, i) => ({ item, i })).filter(({ item, i }) => !item.taskId && lines[i]);
  const addable = untasked.filter(({ i }) => canAdd(i));
  const stepVisible = Boolean(notes) && rec.pendingMarks.length === 0 && editable && untasked.length > 0 && !dismissed;

  const latest = useRef({ untasked, addable, rowFor, lines, busy, rec });
  latest.current = { untasked, addable, rowFor, lines, busy, rec };

  const createItems = useCallback(
    async (entries: { item: EnhanceActionItem; i: number }[]) => {
      const { rowFor: row, lines: live, busy: inFlight, rec: current } = latest.current;
      if (inFlight) return;
      const payload = entries.flatMap(({ item, i }) => {
        const line = live[i];
        if (!line) return [];
        const r = row(i);
        return [
          {
            index: i,
            title: line.text.trim() || item.text,
            assigneeId: r.ownerUserId || undefined,
            dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : undefined,
            status: r.status,
            projectId: current.projectId ? undefined : r.projectId,
            blockId: line.id,
          },
        ];
      });
      if (payload.length === 0) return;
      latest.current.busy = true;
      setBusy(true);
      try {
        const ok = await current.createTasksFromItems(payload);
        if (ok) {
          const boards = new Set(payload.map((p) => p.projectId ?? current.projectId));
          setCreated({ count: payload.length, projectId: boards.size === 1 ? ([...boards][0] ?? null) : null });
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const create = useCallback(() => createItems(latest.current.addable), [createItems]);
  const createOne = useCallback(
    (index: number) => createItems(latest.current.untasked.filter(({ i }) => i === index)),
    [createItems],
  );
  const dismissLine = useCallback((index: number) => {
    const line = latest.current.lines[index];
    if (line) latest.current.rec.removeBlock(line.id);
  }, []);

  useEffect(() => {
    if (created === null) return;
    const timer = setTimeout(() => setCreated(null), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [created]);

  const roster = notes?.roster?.length ? notes.roster : rec.roster;

  const value = useMemo<ActionItemDraft>(
    () => ({
      items,
      rowFor,
      setRow,
      roster,
      projects,
      needsProject,
      editable,
      projectId: rec.projectId ?? null,
      lineFor,
      needsDate,
      canAdd,
      untaskedCount: untasked.length,
      addableCount: addable.length,
      stepVisible,
      dismiss,
      dismissLine,
      busy,
      created: created?.count ?? null,
      boardProjectId: created?.projectId ?? null,
      create,
      createOne,
    }),
    [items, rowFor, setRow, roster, projects, needsProject, editable, rec.projectId, lineFor, needsDate, canAdd, untasked.length, addable.length, stepVisible, dismiss, dismissLine, busy, created, create, createOne],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function ActionItemDraftScope({ rec, children }: { rec: UseMeetingRecording | null; children: ReactNode }) {
  return rec ? <ActionItemDraftProvider rec={rec}>{children}</ActionItemDraftProvider> : <>{children}</>;
}
