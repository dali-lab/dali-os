import { expandOccurrences, googleSeriesBase, googleSeriesBaseUID } from "~/lib/meeting-occurrences";
import type { OccurrenceException } from "~/lib/meeting-occurrences";

export type FoldMeeting = {
  id: string;
  title: string;
  externalEventId: string | null;
  iCalUID: string | null;
  status: string;
  createdAt: Date;
  selectedAt: Date | null;
  durationMinutes: number;
  recurrenceRule: string | null;
  notebookId: string | null;
  participantUserIds: string[];
};

export type FoldNote = { id: string; key: Date | null; archived: boolean; parentPageId: string | null };
export type FoldAttendance = {
  id: string;
  userId: string;
  key: Date;
  present: boolean;
  markedAt: Date | null;
  markedByUserId: string | null;
  absenceNote: string | null;
};
export type FoldRecording = { id: string; key: Date | null };
export type FoldTimeEntry = { id: string; userId: string; key: Date | null };

export type FoldMeetingData = {
  notes: FoldNote[];
  attendance: FoldAttendance[];
  recordings: FoldRecording[];
  timeEntries: FoldTimeEntry[];
  exceptions: OccurrenceException[];
};

export type AttendanceMerge = {
  parentRowId: string;
  splitRowId: string;
  set: { present?: boolean; markedAt?: Date | null; markedByUserId?: string | null; absenceNote?: string };
};

export type PairPlan = {
  parentId: string;
  parentTitle: string;
  splitId: string;
  splitExternalEventId: string;
  skipReason: string | null;
  keys: Date[];
  noteMoves: { pageId: string; key: Date | null }[];
  noteDetaches: { pageId: string; key: Date | null; reason: "conflict" | "archived" }[];
  parentArchivedDetaches: { pageId: string; key: Date | null }[];
  notebookMoves: { pageId: string; notebookId: string }[];
  parentNotebookId: string | null;
  attendanceMoves: string[];
  attendanceMerges: AttendanceMerge[];
  recordingMoves: string[];
  timeEntryMoves: string[];
  timeEntryConflicts: { id: string; userId: string; key: Date }[];
  participantUserIds: string[] | null;
};

export type OrphanSplit = { splitId: string; title: string; externalEventId: string; reason: string };

export type FoldPlan = { pairs: PairPlan[]; orphans: OrphanSplit[] };

const NO_PARENT = "no parent, skipped";
const TIMES_DIFFER = "times differ, needs continuation";
const HAS_EXCEPTIONS = "split row has MeetingException rows, skipped";
const DAY_MS = 24 * 60 * 60_000;

export const isSplitId = (externalEventId: string | null): externalEventId is string =>
  !!externalEventId && googleSeriesBase(externalEventId) !== externalEventId;

const emptyData = (): FoldMeetingData => ({
  notes: [],
  attendance: [],
  recordings: [],
  timeEntries: [],
  exceptions: [],
});

const sameTime = (a: Date | null, b: Date | null) => a !== null && b !== null && a.getTime() === b.getTime();

const byAge = (a: FoldMeeting, b: FoldMeeting) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

function findParent(split: FoldMeeting, live: FoldMeeting[]): FoldMeeting | null {
  const baseId = googleSeriesBase(split.externalEventId!);
  const candidates = live.filter((m) => m.id !== split.id && !isSplitId(m.externalEventId));
  const byId = candidates.filter((m) => m.externalEventId === baseId).sort(byAge);
  if (byId[0]) return byId[0];
  if (!split.iCalUID) return null;
  const baseUid = googleSeriesBaseUID(split.iCalUID);
  return candidates.filter((m) => m.iCalUID === baseUid).sort(byAge)[0] ?? null;
}

/** Every key the split holds data at. Keyless rows (null occurrence) carry no key to check. */
function dataKeys(data: FoldMeetingData): Date[] {
  const all = [
    ...data.notes.map((n) => n.key),
    ...data.attendance.map((a) => a.key),
    ...data.recordings.map((r) => r.key),
    ...data.timeEntries.map((t) => t.key),
  ].filter((k): k is Date => k !== null);
  const seen = new Map<number, Date>();
  for (const k of all) seen.set(k.getTime(), k);
  return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
}

function offRuleKeys(parent: FoldMeeting, parentData: FoldMeetingData, keys: Date[]): Date[] {
  if (keys.length === 0) return [];
  const first = keys[0]!.getTime();
  const last = keys[keys.length - 1]!.getTime();
  const occurrences = expandOccurrences(
    parent,
    parentData.exceptions,
    new Date(first - DAY_MS),
    new Date(last + DAY_MS),
  );
  const starts = new Set(occurrences.map((o) => o.originalStart.getTime()));
  return keys.filter((k) => !starts.has(k.getTime()));
}

function mergeAttendance(parentRow: FoldAttendance, splitRow: FoldAttendance): AttendanceMerge["set"] {
  const set: AttendanceMerge["set"] = {};
  if (splitRow.present && !parentRow.present) {
    set.present = true;
    set.markedAt = splitRow.markedAt;
    set.markedByUserId = splitRow.markedByUserId;
  } else if (
    splitRow.present &&
    parentRow.present &&
    splitRow.markedAt &&
    (!parentRow.markedAt || splitRow.markedAt < parentRow.markedAt)
  ) {
    set.markedAt = splitRow.markedAt;
    set.markedByUserId = splitRow.markedByUserId;
  }
  if (!parentRow.absenceNote && splitRow.absenceNote) set.absenceNote = splitRow.absenceNote;
  return set;
}

type ParentState = {
  notes: FoldNote[];
  attendance: FoldAttendance[];
  timeEntries: FoldTimeEntry[];
  participants: string[];
  notebookId: string | null;
};

function foldPair(
  parent: FoldMeeting,
  split: FoldMeeting,
  parentData: FoldMeetingData,
  splitData: FoldMeetingData,
  state: ParentState,
): PairPlan {
  const plan: PairPlan = {
    parentId: parent.id,
    parentTitle: parent.title,
    splitId: split.id,
    splitExternalEventId: split.externalEventId!,
    skipReason: null,
    keys: [],
    noteMoves: [],
    noteDetaches: [],
    parentArchivedDetaches: [],
    notebookMoves: [],
    parentNotebookId: null,
    attendanceMoves: [],
    attendanceMerges: [],
    recordingMoves: [],
    timeEntryMoves: [],
    timeEntryConflicts: [],
    participantUserIds: null,
  };

  if (splitData.exceptions.length > 0) return { ...plan, skipReason: HAS_EXCEPTIONS };

  let keys = dataKeys(splitData);
  if (keys.length === 0 && split.selectedAt) keys = [split.selectedAt];
  plan.keys = keys;
  const off = offRuleKeys(parent, parentData, keys);
  if (off.length > 0) {
    return { ...plan, skipReason: `${TIMES_DIFFER} (off the parent's rule: ${off.map((k) => k.toISOString()).join(", ")})` };
  }

  if (!state.notebookId && split.notebookId) {
    state.notebookId = split.notebookId;
    plan.parentNotebookId = split.notebookId;
  }

  for (const note of splitData.notes) {
    if (note.archived) {
      plan.noteDetaches.push({ pageId: note.id, key: note.key, reason: "archived" });
      continue;
    }
    if (note.key) {
      const liveHolder = state.notes.find((p) => !p.archived && sameTime(p.key, note.key));
      if (liveHolder) {
        plan.noteDetaches.push({ pageId: note.id, key: note.key, reason: "conflict" });
        continue;
      }
      for (const p of state.notes) {
        if (p.archived && sameTime(p.key, note.key)) {
          plan.parentArchivedDetaches.push({ pageId: p.id, key: p.key });
          p.key = null;
        }
      }
    }
    plan.noteMoves.push({ pageId: note.id, key: note.key });
    state.notes.push({ ...note });
    if (state.notebookId && note.parentPageId !== state.notebookId) {
      plan.notebookMoves.push({ pageId: note.id, notebookId: state.notebookId });
    }
  }

  for (const row of splitData.attendance) {
    const existing = state.attendance.find((p) => p.userId === row.userId && sameTime(p.key, row.key));
    if (!existing) {
      plan.attendanceMoves.push(row.id);
      state.attendance.push({ ...row });
      continue;
    }
    const set = mergeAttendance(existing, row);
    plan.attendanceMerges.push({ parentRowId: existing.id, splitRowId: row.id, set });
    Object.assign(existing, set);
  }

  plan.recordingMoves = splitData.recordings.map((r) => r.id);

  for (const entry of splitData.timeEntries) {
    const clash =
      entry.key !== null && state.timeEntries.some((p) => p.userId === entry.userId && sameTime(p.key, entry.key));
    if (clash) {
      plan.timeEntryConflicts.push({ id: entry.id, userId: entry.userId, key: entry.key! });
      continue;
    }
    plan.timeEntryMoves.push(entry.id);
    state.timeEntries.push({ ...entry });
  }

  const union = [...new Set([...state.participants, ...split.participantUserIds])];
  if (union.length !== state.participants.length) {
    plan.participantUserIds = union;
    state.participants = union;
  }

  return plan;
}

/**
 * Plan folding each live `_R` split row into the live meeting it split from.
 * Pure: plain rows in, a plan out. Splits sharing a parent are folded oldest
 * first against the parent as the earlier folds leave it.
 */
export function planSplitFolds(meetings: FoldMeeting[], dataById: Map<string, FoldMeetingData>): FoldPlan {
  const live = meetings.filter((m) => m.status !== "Cancelled");
  const dataOf = (id: string) => dataById.get(id) ?? emptyData();
  const plan: FoldPlan = { pairs: [], orphans: [] };

  const splitsByParent = new Map<string, FoldMeeting[]>();
  for (const split of live.filter((m) => isSplitId(m.externalEventId)).sort(byAge)) {
    const parent = findParent(split, live);
    if (!parent) {
      plan.orphans.push({
        splitId: split.id,
        title: split.title,
        externalEventId: split.externalEventId!,
        reason: NO_PARENT,
      });
      continue;
    }
    splitsByParent.set(parent.id, [...(splitsByParent.get(parent.id) ?? []), split]);
  }

  for (const [parentId, splits] of splitsByParent) {
    const parent = live.find((m) => m.id === parentId)!;
    const parentData = dataOf(parentId);
    const state: ParentState = {
      notes: parentData.notes.map((n) => ({ ...n })),
      attendance: parentData.attendance.map((a) => ({ ...a })),
      timeEntries: parentData.timeEntries.map((t) => ({ ...t })),
      participants: [...parent.participantUserIds],
      notebookId: parent.notebookId,
    };
    for (const split of splits) {
      plan.pairs.push(foldPair(parent, split, parentData, dataOf(split.id), state));
    }
  }

  return plan;
}

const iso = (d: Date | null) => (d ? d.toISOString() : "no key");

export function formatPairPlan(p: PairPlan): string {
  const head = `${p.parentTitle} (${p.parentId}) <- split ${p.splitId} (${p.splitExternalEventId})`;
  if (p.skipReason) return `${head}\n  SKIPPED: ${p.skipReason}`;
  const lines = [head];
  const list = (label: string, items: string[]) => {
    if (items.length > 0) lines.push(`  ${label}: ${items.join(", ")}`);
  };
  list("notes moved", p.noteMoves.map((n) => iso(n.key)));
  list("notes detached (conflict)", p.noteDetaches.filter((n) => n.reason === "conflict").map((n) => `${n.pageId} @ ${iso(n.key)}`));
  list("notes detached (archived)", p.noteDetaches.filter((n) => n.reason === "archived").map((n) => `${n.pageId} @ ${iso(n.key)}`));
  list("parent archived notes detached", p.parentArchivedDetaches.map((n) => `${n.pageId} @ ${iso(n.key)}`));
  list("notes refiled into the parent notebook", p.notebookMoves.map((n) => n.pageId));
  if (p.parentNotebookId) lines.push(`  parent notebook set to ${p.parentNotebookId}`);
  list("attendance moved", [`${p.attendanceMoves.length}`].filter(() => p.attendanceMoves.length > 0));
  list("attendance merged", [`${p.attendanceMerges.length}`].filter(() => p.attendanceMerges.length > 0));
  list("recordings moved", [`${p.recordingMoves.length}`].filter(() => p.recordingMoves.length > 0));
  list("time entries moved", [`${p.timeEntryMoves.length}`].filter(() => p.timeEntryMoves.length > 0));
  list("time entry conflicts (left on split)", p.timeEntryConflicts.map((t) => `${t.id} @ ${iso(t.key)}`));
  if (p.participantUserIds) lines.push(`  participants now ${p.participantUserIds.length}`);
  lines.push("  split row will be Cancelled");
  return lines.join("\n");
}
