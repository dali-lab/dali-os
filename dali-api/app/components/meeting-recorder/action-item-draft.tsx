import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { actionItemMatchesBlock, type EnhanceActionItem } from "./enhance-plan";
import type { RosterUser } from "./types";
import type { UseMeetingRecording } from "./use-meeting-recording";

export const SUCCESS_VISIBLE_MS = 4000;
const NO_ITEMS: EnhanceActionItem[] = [];

export type ActionItemRow = { checked: boolean; ownerUserId: string; ownerName: string; dueAt: string };

export type ActionItemDraft = {
  items: EnhanceActionItem[];
  rowFor: (index: number) => ActionItemRow;
  setRow: (index: number, patch: Partial<ActionItemRow>) => void;
  roster: RosterUser[];
  editable: boolean;
  projectId: string | null;
  orphanedTasks: EnhanceActionItem[];
  untaskedCount: number;
  checkedCount: number;
  unmatchedCount: number;
  stepVisible: boolean;
  dismiss: () => void;
  busy: boolean;
  created: number | null;
  create: () => Promise<void>;
  createOne: (index: number) => Promise<void>;
};

const DraftContext = createContext<ActionItemDraft | null>(null);

export function useActionItemDraft(): ActionItemDraft | null {
  return useContext(DraftContext);
}

function liveChecklist(rec: Pick<UseMeetingRecording, "getNoteState">): string[] | null {
  const state = rec.getNoteState?.();
  return state ? state.blocks.filter((b) => b.type === "checkListItem").map((b) => b.text) : null;
}

function liveLineFor(item: EnhanceActionItem, lines: string[] | null): string | null {
  return lines?.find((line) => actionItemMatchesBlock(item.text, line)) ?? null;
}

function onLiveChecklist(item: EnhanceActionItem, lines: string[] | null): boolean {
  return liveLineFor(item, lines) !== null;
}

/** True when ⌘Z took Enhance's writing back out: the note was never reviewed
 *  and none of the plan's action items is a checklist line any more (an item
 *  with a task keeps the note in its enhanced state). */
export function enhanceWasUndone(rec: Pick<UseMeetingRecording, "getNoteState" | "reviewedAt" | "enhanceNotes">): boolean {
  const lines = liveChecklist(rec);
  if (lines === null || rec.reviewedAt) return false;
  const items = rec.enhanceNotes?.plan.actionItems ?? NO_ITEMS;
  if (items.length === 0) return false;
  return !items.some((item) => item.taskId || onLiveChecklist(item, lines));
}

function seedRow(item: EnhanceActionItem): ActionItemRow {
  return { checked: true, ownerUserId: item.ownerUserId ?? "", ownerName: item.ownerName ?? "", dueAt: item.due ?? "" };
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

  const [edits, setEdits] = useState<{ snapshotAt: string | null; rows: Record<number, Partial<ActionItemRow>> }>({
    snapshotAt,
    rows: {},
  });
  const rows = edits.snapshotAt === snapshotAt ? edits.rows : {};
  const [dismissedKeys, setDismissedKeys] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<number | null>(null);

  const key = snapshotAt ? dismissKey(rec.recordingId, snapshotAt) : null;
  const dismissed = key ? Boolean(dismissedKeys[key]) || readDismissed(key) : false;

  const rowFor = useCallback(
    (index: number): ActionItemRow => {
      const item = items[index];
      return { ...(item ? seedRow(item) : { checked: true, ownerUserId: "", ownerName: "", dueAt: "" }), ...rows[index] };
    },
    [items, rows],
  );

  const setRow = useCallback(
    (index: number, patch: Partial<ActionItemRow>) => {
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

  const canTasks = Boolean(rec.canCreateTasks && rec.projectId);
  const lines = liveChecklist(rec);
  const untasked = items.map((item, i) => ({ item, i })).filter(({ item }) => !item.taskId && onLiveChecklist(item, lines));
  const checked = untasked.filter(({ i }) => rowFor(i).checked);
  const unmatchedCount = checked.filter(({ item, i }) => item.ownerName && !rowFor(i).ownerUserId).length;
  const anyOnNote = checked.length > 0;
  const orphanKey = lines === null ? "" : items.filter((item) => item.taskId && !onLiveChecklist(item, lines)).map((item) => item.taskId).join("|");
  const orphanedTasks = useMemo(
    () => (orphanKey === "" ? NO_ITEMS : items.filter((item) => item.taskId && orphanKey.split("|").includes(item.taskId))),
    [items, orphanKey],
  );
  const stepVisible = Boolean(notes) && rec.pendingMarks.length === 0 && canTasks && anyOnNote && !dismissed;

  const itemsRef = useRef({ untasked, checked, rowFor, lines, busy });
  itemsRef.current = { untasked, checked, rowFor, lines, busy };

  const createItems = useCallback(
    async (entries: { item: EnhanceActionItem; i: number }[]) => {
      const { rowFor: row, lines: live, busy: inFlight } = itemsRef.current;
      if (inFlight) return;
      const payload = entries.flatMap(({ item, i }) => {
        const line = liveLineFor(item, live);
        if (!line) return [];
        const r = row(i);
        return [
          {
            index: i,
            title: line.trim() || item.text,
            assigneeId: r.ownerUserId || undefined,
            dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : undefined,
          },
        ];
      });
      if (payload.length === 0) return;
      itemsRef.current.busy = true;
      setBusy(true);
      try {
        const ok = await rec.createTasksFromItems(payload);
        if (ok) setCreated(payload.length);
      } finally {
        setBusy(false);
      }
    },
    [rec],
  );

  const create = useCallback(() => createItems(itemsRef.current.checked), [createItems]);
  const createOne = useCallback(
    (index: number) => createItems(itemsRef.current.untasked.filter(({ i }) => i === index)),
    [createItems],
  );

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
      editable: canTasks,
      projectId: rec.projectId ?? null,
      orphanedTasks,
      untaskedCount: untasked.length,
      checkedCount: checked.length,
      unmatchedCount,
      stepVisible,
      dismiss,
      busy,
      created,
      create,
      createOne,
    }),
    [items, rowFor, setRow, roster, canTasks, rec.projectId, orphanedTasks, untasked.length, checked.length, unmatchedCount, stepVisible, dismiss, busy, created, create, createOne],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function ActionItemDraftScope({ rec, children }: { rec: UseMeetingRecording | null; children: ReactNode }) {
  return rec ? <ActionItemDraftProvider rec={rec}>{children}</ActionItemDraftProvider> : <>{children}</>;
}
