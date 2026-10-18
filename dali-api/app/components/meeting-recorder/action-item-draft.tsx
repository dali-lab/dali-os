import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { EnhanceActionItem } from "./enhance-plan";
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
  untaskedCount: number;
  checkedCount: number;
  unmatchedCount: number;
  stepVisible: boolean;
  dismiss: () => void;
  busy: boolean;
  created: number | null;
  create: () => Promise<void>;
};

const DraftContext = createContext<ActionItemDraft | null>(null);

export function useActionItemDraft(): ActionItemDraft | null {
  return useContext(DraftContext);
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
  const untasked = items.map((item, i) => ({ item, i })).filter(({ item }) => !item.taskId);
  const checked = untasked.filter(({ i }) => rowFor(i).checked);
  const unmatchedCount = checked.filter(({ item, i }) => item.ownerName && !rowFor(i).ownerUserId).length;
  const stepVisible = Boolean(notes) && rec.pendingMarks.length === 0 && canTasks && untasked.length > 0 && !dismissed;

  const itemsRef = useRef({ checked, rowFor });
  itemsRef.current = { checked, rowFor };

  const create = useCallback(async () => {
    const payload = itemsRef.current.checked.map(({ item, i }) => {
      const row = itemsRef.current.rowFor(i);
      return {
        index: i,
        title: item.text,
        assigneeId: row.ownerUserId || undefined,
        dueAt: row.dueAt ? new Date(row.dueAt).toISOString() : undefined,
      };
    });
    if (payload.length === 0) return;
    setBusy(true);
    try {
      const ok = await rec.createTasksFromItems(payload);
      if (ok) {
        setCreated(payload.length);
        dismiss();
      }
    } finally {
      setBusy(false);
    }
  }, [rec, dismiss]);

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
      untaskedCount: untasked.length,
      checkedCount: checked.length,
      unmatchedCount,
      stepVisible,
      dismiss,
      busy,
      created,
      create,
    }),
    [items, rowFor, setRow, roster, canTasks, rec.projectId, untasked.length, checked.length, unmatchedCount, stepVisible, dismiss, busy, created, create],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function ActionItemDraftScope({ rec, children }: { rec: UseMeetingRecording | null; children: ReactNode }) {
  return rec ? <ActionItemDraftProvider rec={rec}>{children}</ActionItemDraftProvider> : <>{children}</>;
}
