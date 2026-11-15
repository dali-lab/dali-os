// Joint optimizer for scheduling several meetings across overlapping groups.
//
// The problem the raw free/busy tools can't solve on their own: when one person
// belongs to more than one group, placing them in meeting A at a given time
// makes them unavailable for any other meeting scheduled at an overlapping time.
// Picking each group's best slot independently double-books those people. This
// module assigns every meeting a slot so that the TOTAL number of people who can
// actually attend a meeting they belong to is maximized, counting each person at
// most once per overlapping time.
//
// It is deliberately pure — no DB, no timezone, no Google. Callers precompute
// each meeting's viable candidate slots (with the set of members free at each)
// and hand them in; this module does only the combinatorial assignment. That
// keeps the search deterministic and unit-testable in isolation.

export interface CandidateSlot {
  startMs: number;
  endMs: number;
  /** Member userIds free for the whole slot. Required members are guaranteed
   *  present (the caller drops slots that miss a required member). */
  freeIds: string[];
}

export interface OptimizerMeeting {
  key: string;
  memberIds: string[];
  /** Viable slots, in ascending start order. Empty ⇒ meeting is unschedulable. */
  candidates: CandidateSlot[];
}

export interface MeetingAssignment {
  key: string;
  /** Chosen slot, or null when the meeting had no viable candidate. */
  slot: { startMs: number; endMs: number } | null;
  /** Members who attend this meeting (free at the slot and not pulled into an
   *  overlapping meeting they also belong to). */
  attendeeIds: string[];
  /** Members not free at the chosen slot. */
  unavailableIds: string[];
  /** Members free at the slot but attending an overlapping meeting instead. */
  conflicts: { userId: string; withKey: string }[];
  /** Other viable slots, best-attendance first, excluding the chosen one. */
  alternatives: { startMs: number; endMs: number; freeCount: number }[];
}

export interface OptimizeResult {
  meetings: MeetingAssignment[];
  /** People-meetings actually attendable under the chosen schedule. */
  totalAttendance: number;
  /** Upper bound: everyone attends every meeting they belong to (Σ member counts). */
  maxPossibleAttendance: number;
}

// Max passes of coordinate ascent. Each pass re-optimizes every meeting against
// the others; the search converges well before this on realistic inputs.
const MAX_PASSES = 12;

/** Maximum count of pairwise non-overlapping intervals (classic activity
 *  selection: sort by end, greedily take the earliest-ending compatible one). */
function maxNonOverlap(intervals: { start: number; end: number }[]): number {
  if (intervals.length <= 1) return intervals.length;
  const sorted = [...intervals].sort((a, b) => a.end - b.end || a.start - b.start);
  let count = 0;
  let lastEnd = -Infinity;
  for (const iv of sorted) {
    if (iv.start >= lastEnd) {
      count++;
      lastEnd = iv.end;
    }
  }
  return count;
}

/** Total attendance of a (partial) assignment: for each user, the most meetings
 *  they can physically attend among the ones they're free for that are placed. */
function scoreAssignment(
  meetings: OptimizerMeeting[],
  assignment: (number | null)[],
): number {
  const byUser = new Map<string, { start: number; end: number }[]>();
  for (let i = 0; i < meetings.length; i++) {
    const ci = assignment[i];
    if (ci == null) continue;
    const slot = meetings[i].candidates[ci];
    for (const uid of slot.freeIds) {
      const arr = byUser.get(uid);
      if (arr) arr.push({ start: slot.startMs, end: slot.endMs });
      else byUser.set(uid, [{ start: slot.startMs, end: slot.endMs }]);
    }
  }
  let total = 0;
  for (const intervals of byUser.values()) total += maxNonOverlap(intervals);
  return total;
}

/** Pick the candidate index for meeting `m` that maximizes the objective given
 *  the rest of `assignment` fixed. Ties break toward the earlier slot, then the
 *  higher standalone free count, for stable, sensible output. */
function bestSlotFor(
  meetings: OptimizerMeeting[],
  assignment: (number | null)[],
  m: number,
): { index: number | null; score: number } {
  const cands = meetings[m].candidates;
  if (cands.length === 0) return { index: null, score: scoreAssignment(meetings, assignment) };
  const original = assignment[m];
  let bestIndex = 0;
  let bestScore = -Infinity;
  let bestStart = Infinity;
  let bestFree = -Infinity;
  for (let c = 0; c < cands.length; c++) {
    assignment[m] = c;
    const score = scoreAssignment(meetings, assignment);
    const start = cands[c].startMs;
    const free = cands[c].freeIds.length;
    if (
      score > bestScore ||
      (score === bestScore && start < bestStart) ||
      (score === bestScore && start === bestStart && free > bestFree)
    ) {
      bestScore = score;
      bestIndex = c;
      bestStart = start;
      bestFree = free;
    }
  }
  assignment[m] = original; // side-effect free: callers set the chosen index
  return { index: bestIndex, score: bestScore };
}

/** Greedy build in a given meeting order, then coordinate-ascent local search. */
function solveWithOrder(
  meetings: OptimizerMeeting[],
  order: number[],
): { assignment: (number | null)[]; score: number } {
  const assignment: (number | null)[] = meetings.map(() => null);
  for (const m of order) assignment[m] = bestSlotFor(meetings, assignment, m).index;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (let m = 0; m < meetings.length; m++) {
      if (meetings[m].candidates.length === 0) continue;
      const before = assignment[m];
      const best = bestSlotFor(meetings, assignment, m);
      if (best.index !== before) {
        assignment[m] = best.index;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return { assignment, score: scoreAssignment(meetings, assignment) };
}

/** Resolve a final assignment into per-meeting attendance, splitting free-but-
 *  double-booked members into conflicts and naming the meeting that won them. */
function resolveAssignment(
  meetings: OptimizerMeeting[],
  assignment: (number | null)[],
): MeetingAssignment[] {
  // For each user, the placed meetings they're free for.
  const byUser = new Map<string, { meetingIdx: number; start: number; end: number }[]>();
  for (let i = 0; i < meetings.length; i++) {
    const ci = assignment[i];
    if (ci == null) continue;
    const slot = meetings[i].candidates[ci];
    for (const uid of slot.freeIds) {
      const entry = { meetingIdx: i, start: slot.startMs, end: slot.endMs };
      const arr = byUser.get(uid);
      if (arr) arr.push(entry);
      else byUser.set(uid, [entry]);
    }
  }

  // Per user: greedily keep a max non-overlapping set (the meetings they attend);
  // the rest are conflicts, each blamed on a kept meeting it overlaps.
  const attends = new Set<string>(); // `${uid}#${meetingIdx}`
  const conflictWith = new Map<string, string>(); // `${uid}#${meetingIdx}` -> winning key
  for (const [uid, entries] of byUser) {
    const sorted = [...entries].sort((a, b) => a.end - b.end || a.start - b.start);
    const kept: { meetingIdx: number; start: number; end: number }[] = [];
    let lastEnd = -Infinity;
    for (const e of sorted) {
      if (e.start >= lastEnd) {
        kept.push(e);
        lastEnd = e.end;
        attends.add(`${uid}#${e.meetingIdx}`);
      }
    }
    for (const e of sorted) {
      if (attends.has(`${uid}#${e.meetingIdx}`)) continue;
      const clash = kept.find((k) => e.start < k.end && k.start < e.end) ?? kept[0];
      if (clash) conflictWith.set(`${uid}#${e.meetingIdx}`, meetings[clash.meetingIdx].key);
    }
  }

  return meetings.map((meeting, i) => {
    const ci = assignment[i];
    if (ci == null) {
      return {
        key: meeting.key,
        slot: null,
        attendeeIds: [],
        unavailableIds: [...meeting.memberIds],
        conflicts: [],
        alternatives: [],
      };
    }
    const slot = meeting.candidates[ci];
    const freeSet = new Set(slot.freeIds);
    const attendeeIds: string[] = [];
    const unavailableIds: string[] = [];
    const conflicts: { userId: string; withKey: string }[] = [];
    for (const uid of meeting.memberIds) {
      if (!freeSet.has(uid)) {
        unavailableIds.push(uid);
      } else if (attends.has(`${uid}#${i}`)) {
        attendeeIds.push(uid);
      } else {
        conflicts.push({ userId: uid, withKey: conflictWith.get(`${uid}#${i}`) ?? "" });
      }
    }
    const alternatives = meeting.candidates
      .map((c, idx) => ({ idx, startMs: c.startMs, endMs: c.endMs, freeCount: c.freeIds.length }))
      .filter((c) => c.idx !== ci)
      .sort((a, b) => b.freeCount - a.freeCount || a.startMs - b.startMs)
      .map(({ startMs, endMs, freeCount }) => ({ startMs, endMs, freeCount }));

    return { key: meeting.key, slot: { startMs: slot.startMs, endMs: slot.endMs }, attendeeIds, unavailableIds, conflicts, alternatives };
  });
}

/**
 * Assign every meeting a time slot to maximize total attendable people-meetings.
 * Runs several deterministic greedy seedings (most-constrained-first, largest
 * group first, most-shared-members first, and input order), local-searches each,
 * and keeps the best — enough to find the optimum on lab-sized inputs without a
 * general ILP solver.
 */
export function optimizeMeetingSchedule(meetings: OptimizerMeeting[]): OptimizeResult {
  const maxPossibleAttendance = meetings.reduce((sum, m) => sum + m.memberIds.length, 0);

  if (meetings.length === 0) {
    return { meetings: [], totalAttendance: 0, maxPossibleAttendance: 0 };
  }

  // Shared-membership weight: how many members each meeting has in common with
  // any other meeting. High-overlap meetings are the ones a good schedule must
  // spread out, so seeding them first helps the greedy pass.
  const sharedCount = meetings.map((m, i) => {
    const others = new Set<string>();
    meetings.forEach((o, j) => {
      if (j !== i) o.memberIds.forEach((id) => others.add(id));
    });
    return m.memberIds.reduce((n, id) => n + (others.has(id) ? 1 : 0), 0);
  });

  const identity = meetings.map((_, i) => i);
  const byConstraint = [...identity].sort(
    (a, b) => meetings[a].candidates.length - meetings[b].candidates.length,
  );
  const bySize = [...identity].sort((a, b) => meetings[b].memberIds.length - meetings[a].memberIds.length);
  const byShared = [...identity].sort((a, b) => sharedCount[b] - sharedCount[a]);

  const orders = [byConstraint, byShared, bySize, identity];

  let best: { assignment: (number | null)[]; score: number } | null = null;
  for (const order of orders) {
    const solved = solveWithOrder(meetings, order);
    if (!best || solved.score > best.score) best = solved;
  }

  const assignment = best!.assignment;
  return {
    meetings: resolveAssignment(meetings, assignment),
    totalAttendance: best!.score,
    maxPossibleAttendance,
  };
}
