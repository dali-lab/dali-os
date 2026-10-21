// A cycle's timeline: its phases and delib rounds, in order, each on some
// weeks of the term. Setup, Review and Decisions are always there; delib
// rounds and Interviews rounds go between Review and Decisions in whatever
// order and number the cycle needs. The setup page renders a tab per block, and delib
// boards find their round (columns, who qualifies) from here. Client-safe.

export type FixedKey = "setup" | "review" | "interviews" | "decisions";

// Interviews blocks after the first carry an id and label; the first one
// predates round ids and reads as FIRST_INTERVIEW_ROUND_ID.
export type PhaseBlock = { kind: "phase"; key: FixedKey; weeks: [number, number]; id?: string; label?: string };
export type DelibBlock = { kind: "delib"; id: string; label: string; weeks: [number, number] };
export type TimelineBlock = PhaseBlock | DelibBlock;
export type Timeline = TimelineBlock[];

export const MAX_WEEK = 15;

export const PHASE_LABELS: Record<FixedKey, string> = {
  setup: "Setup",
  review: "Review",
  interviews: "Interviews",
  decisions: "Decisions",
};

// Round ids for the two rounds every cycle had before rounds were flexible;
// boards opened then are keyed to these.
export const FIRST_ROUND_ID = "first";
export const FINAL_ROUND_ID = "final";

// The first Interviews round's id: what Interview, InterviewConfig,
// CycleInterviewer and invite rows default to in the database.
export const FIRST_INTERVIEW_ROUND_ID = "interviews";

const phase = (key: FixedKey, a: number, b: number): PhaseBlock => ({ kind: "phase", key, weeks: [a, b] });
const delib = (id: string, label: string, a: number, b: number): DelibBlock => ({
  kind: "delib",
  id,
  label,
  weeks: [a, b],
});

/** The standard timeline, trimmed to a cycle's shape. */
export function defaultTimeline(opts: { firstDelib: boolean; interviews: boolean }): Timeline {
  return [
    phase("setup", 1, 5),
    phase("review", 6, 6),
    ...(opts.firstDelib || opts.interviews ? [delib(FIRST_ROUND_ID, "First delib", 6, 6)] : []),
    ...(opts.interviews ? [phase("interviews", 7, 7)] : []),
    delib(FINAL_ROUND_ID, "Final delib", 8, 8),
    phase("decisions", 9, 9),
  ];
}

export const STANDARD_TIMELINE = defaultTimeline({ firstDelib: true, interviews: true });

// ─── Reading ────────────────────────────────────────────────────────────────

function isWeeks(w: unknown): w is [number, number] {
  return (
    Array.isArray(w) &&
    w.length === 2 &&
    w.every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_WEEK) &&
    (w[0] as number) <= (w[1] as number)
  );
}

/** A stored timeline, or `fallback` when nothing (or nothing usable) is stored. */
export function parseTimeline(raw: unknown, fallback: Timeline = STANDARD_TIMELINE): Timeline {
  if (!Array.isArray(raw)) return fallback;
  const blocks: Timeline = [];
  for (const b of raw) {
    if (!b || typeof b !== "object" || !isWeeks((b as TimelineBlock).weeks)) return fallback;
    const block = b as TimelineBlock;
    if (block.kind === "phase" && block.key in PHASE_LABELS) {
      const named = block.key === "interviews" && typeof block.id === "string";
      blocks.push({
        kind: "phase",
        key: block.key,
        weeks: block.weeks,
        ...(named && { id: block.id, label: typeof block.label === "string" ? block.label : undefined }),
      });
    } else if (block.kind === "delib" && typeof block.id === "string" && typeof block.label === "string") {
      blocks.push({ kind: "delib", id: block.id, label: block.label, weeks: block.weeks });
    } else {
      return fallback;
    }
  }
  return validateTimeline(blocks) ? fallback : blocks;
}

/**
 * Why a timeline can't be used, or null if it can:
 *  - Setup then Review first and Decisions last, once each;
 *  - at least one delib round;
 *  - each Interviews round sits right after a delib round (it decides who
 *    interviews) and has a delib round somewhere after it (to decide after
 *    interviews), and has its own id;
 *  - weeks 1 to MAX_WEEK, start ≤ end, and no block starts before the one
 *    ahead of it (overlap is fine).
 */
export function validateTimeline(t: Timeline): string | null {
  const keys = t.map((b) => (b.kind === "phase" ? b.key : "delib"));
  if (keys[0] !== "setup" || keys[1] !== "review" || keys[keys.length - 1] !== "decisions") {
    return "Setup and Review come first and Decisions comes last.";
  }
  const middle = keys.slice(2, -1);
  if (middle.some((k) => k !== "delib" && k !== "interviews")) {
    return "Only delib rounds and Interviews go between Review and Decisions.";
  }
  if (!middle.includes("delib")) return "A cycle needs at least one delib round.";
  for (let iv = 0; iv < middle.length; iv++) {
    if (middle[iv] !== "interviews") continue;
    if (middle[iv - 1] !== "delib") return "Interviews needs a delib round right before it.";
    if (!middle.slice(iv + 1).includes("delib")) return "Interviews needs a delib round after it.";
  }
  const ids = t.filter((b): b is DelibBlock => b.kind === "delib").map((b) => b.id);
  if (new Set(ids).size !== ids.length) return "Each delib round needs its own id.";
  const ivIds = interviewRounds(t).map((b) => b.id);
  if (new Set(ivIds).size !== ivIds.length) return "Each Interviews round needs its own id.";
  const issues = weekIssues(t);
  const i = issues.findIndex((x) => x !== null);
  return i === -1 ? null : `${blockLabel(t[i])} ${issues[i]}.`;
}

/**
 * What's wrong with each block's weeks, or null where they fit: outside
 * weeks 1 to MAX_WEEK, ending before it starts, or starting before the block
 * ahead of it (overlap is fine). One entry per block, so the timeline editor
 * can flag the exact rows; validateTimeline reports the first.
 */
export function weekIssues(t: Timeline): (string | null)[] {
  let prevStart = 0;
  return t.map((b) => {
    const [start, end] = b.weeks;
    if (![start, end].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_WEEK)) {
      return `runs outside weeks 1 to ${MAX_WEEK}`;
    }
    if (start > end) return "ends before it starts";
    if (start < prevStart) return "starts before the block ahead of it";
    prevStart = start;
    return null;
  });
}

export function blockLabel(b: TimelineBlock): string {
  return b.kind === "phase" ? (b.label ?? PHASE_LABELS[b.key]) : b.label;
}

/** A stable key per block: the phase key, `interviews:<id>` for a later
 *  Interviews round, or `delib:<id>`. */
export function blockKey(b: TimelineBlock): string {
  if (b.kind === "delib") return `delib:${b.id}`;
  return b.id ? `${b.key}:${b.id}` : b.key;
}

export function weeksLabel(b: { weeks: [number, number] }): string {
  const [a, z] = b.weeks;
  return a === z ? `Week ${a}` : `Week ${a}–${z}`;
}

export function hasInterviews(t: Timeline): boolean {
  return t.some(isInterviewsBlock);
}

export function isInterviewsBlock(b: TimelineBlock): b is PhaseBlock {
  return b.kind === "phase" && b.key === "interviews";
}

// ─── Interview rounds ───────────────────────────────────────────────────────

export type InterviewRound = {
  id: string;
  label: string;
  /** 0-based position among the Interviews rounds; 0 is the first. */
  index: number;
  weeks: [number, number];
  /** The timeline tab key for this round's block. */
  key: string;
};

export function interviewRoundId(b: PhaseBlock): string {
  return b.id ?? FIRST_INTERVIEW_ROUND_ID;
}

export function interviewRounds(t: Timeline): InterviewRound[] {
  return t.filter(isInterviewsBlock).map((b, index) => ({
    id: interviewRoundId(b),
    label: blockLabel(b),
    index,
    weeks: b.weeks,
    key: blockKey(b),
  }));
}

export function findInterviewRound(t: Timeline, id: string): InterviewRound | null {
  return interviewRounds(t).find((r) => r.id === id) ?? null;
}

/** The Interviews round a timeline tab key points at, if any. */
export function interviewRoundForTab(t: Timeline, tab: string | null | undefined): InterviewRound | null {
  return interviewRounds(t).find((r) => r.key === tab) ?? null;
}

/**
 * Interviews grouped by the round they belong to, in timeline order, each
 * group labelled by its round. Interviews from a round no longer on the
 * timeline keep their own group at the end. Rounds without interviews are
 * left out.
 */
export function groupByInterviewRound<T extends { interviewRoundId: string }>(
  t: Timeline,
  items: T[],
): { roundId: string; label: string; items: T[] }[] {
  const rounds = interviewRounds(t);
  const order = (id: string) => {
    const i = rounds.findIndex((r) => r.id === id);
    return i === -1 ? rounds.length : i;
  };
  const ids = [...new Set(items.map((x) => x.interviewRoundId))].sort((a, b) => order(a) - order(b));
  return ids.map((roundId) => ({
    roundId,
    label: rounds.find((r) => r.id === roundId)?.label ?? PHASE_LABELS.interviews,
    items: items.filter((x) => x.interviewRoundId === roundId),
  }));
}

/** The round a hand-made invite is for: the first one the applicant hasn't
 *  been invited to or interviewed in yet, else the last. */
export function nextInterviewRoundId(t: Timeline, doneRoundIds: Set<string>): string {
  const rounds = interviewRounds(t);
  return (rounds.find((r) => !doneRoundIds.has(r.id)) ?? rounds.at(-1))?.id ?? FIRST_INTERVIEW_ROUND_ID;
}

/** A new Interviews round block: `iv<n>`, labelled "Interviews <n>". */
export function newInterviewRound(t: Timeline, weeks: [number, number]): PhaseBlock {
  const taken = new Set(interviewRounds(t).map((r) => r.id));
  let n = interviewRounds(t).length + 1;
  while (taken.has(`iv${n}`)) n++;
  return { kind: "phase", key: "interviews", id: `iv${n}`, label: `Interviews ${n}`, weeks };
}

// ─── Delib rounds ───────────────────────────────────────────────────────────

export const INTERVIEW_ROUND_COLUMNS = ["No Decision", "Interview", "Reject"] as const;
export const ADVANCE_ROUND_COLUMNS = ["No Decision", "Advance", "Reject"] as const;
export const FINAL_ROUND_COLUMNS = ["Accept", "Waitlist", "Reject"] as const;

export type Round = DelibBlock & {
  /** 0-based position among the rounds. */
  index: number;
  /** The last round makes the accept/waitlist/reject decisions. */
  isFinal: boolean;
  /** Interviews comes right after this round, so advancing means an invite. */
  leadsToInterviews: boolean;
  /** Interviews sits between the previous round and this one. */
  afterInterviews: boolean;
  /** The Interviews round this round's "Interview" column invites to. */
  interviewRoundId: string | null;
  /** The Interviews round between the previous round and this one. */
  afterInterviewRoundId: string | null;
  columns: readonly string[];
  /** The column that moves someone on (none on the final round). */
  advanceColumn: "Interview" | "Advance" | null;
};

export function delibRounds(t: Timeline): Round[] {
  const rounds: Round[] = [];
  let sinceLastRound: TimelineBlock[] = [];
  const lastRoundAt = t.map((b) => b.kind).lastIndexOf("delib");
  t.forEach((b, i) => {
    if (b.kind !== "delib") {
      sinceLastRound.push(b);
      return;
    }
    const next = t[i + 1];
    const leadsToInterviews = !!next && isInterviewsBlock(next);
    const isFinal = i === lastRoundAt;
    const before = rounds.length > 0 ? sinceLastRound.filter(isInterviewsBlock).at(-1) : undefined;
    rounds.push({
      ...b,
      index: rounds.length,
      isFinal,
      leadsToInterviews,
      afterInterviews: !!before,
      interviewRoundId: leadsToInterviews && next.kind === "phase" ? interviewRoundId(next) : null,
      afterInterviewRoundId: before ? interviewRoundId(before) : null,
      columns: isFinal ? FINAL_ROUND_COLUMNS : leadsToInterviews ? INTERVIEW_ROUND_COLUMNS : ADVANCE_ROUND_COLUMNS,
      advanceColumn: isFinal ? null : leadsToInterviews ? "Interview" : "Advance",
    });
    sinceLastRound = [];
  });
  return rounds;
}

export function findRound(t: Timeline, roundId: string): Round | null {
  return delibRounds(t).find((r) => r.id === roundId) ?? null;
}

// ─── Editing ────────────────────────────────────────────────────────────────

/**
 * Why an open cycle's timeline can't change from `current` to `next`, or null.
 * Once the cycle opens, blocks can't be removed or reordered (that changes who
 * gets decided when), but new ones can be added after the last round that has
 * a board, which is how a second Interviews round joins a live cycle.
 */
export function openTimelineChange(current: Timeline, next: Timeline, roundsWithBoards: Set<string>): string | null {
  const nextKeys = next.map(blockKey);
  const kept = current.map((b) => nextKeys.indexOf(blockKey(b)));
  if (kept.some((i) => i === -1)) return "Blocks can't be removed once the cycle opens.";
  if (kept.some((i, j) => j > 0 && i < kept[j - 1])) return "Blocks can't be reordered once the cycle opens.";
  const lastBoard = next.reduce((at, b, i) => (b.kind === "delib" && roundsWithBoards.has(b.id) ? i : at), -1);
  const currentKeys = new Set(current.map(blockKey));
  const early = next.findIndex((b, i) => i <= lastBoard && !currentKeys.has(blockKey(b)));
  if (early !== -1) return `New blocks go after ${blockLabel(next[lastBoard])}, which already has a board.`;
  return null;
}

/** Whether a block may be removed: only Interviews and delib rounds, never a
 *  round that already has a board, and only if what's left is still valid
 *  (e.g. not the round Interviews depends on). */
export function canRemove(t: Timeline, b: TimelineBlock, roundsWithBoards: Set<string> = new Set()): boolean {
  if (b.kind === "phase" && b.key !== "interviews") return false;
  if (b.kind === "delib" && roundsWithBoards.has(b.id)) return false;
  return validateTimeline(t.filter((x) => x !== b)) === null;
}

/** Whether inserting a block at `index` (before the block now there) can yield
 *  a valid timeline, used to offer Add slots. */
export function canInsertAt(t: Timeline, index: number, block: TimelineBlock): boolean {
  const next = [...t.slice(0, index), block, ...t.slice(index)];
  return validateTimeline(next) === null;
}

/** A new delib round's id. Short and unique within the timeline. */
export function newRoundId(t: Timeline): string {
  const taken = new Set(t.filter((b): b is DelibBlock => b.kind === "delib").map((b) => b.id));
  let n = t.filter((b) => b.kind === "delib").length + 1;
  while (taken.has(`r${n}`)) n++;
  return `r${n}`;
}
