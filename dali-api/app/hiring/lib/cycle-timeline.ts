// A cycle's timeline: its phases and delib rounds, in order, each on some
// weeks of the term. Setup, Review and Decisions are always there; delib
// rounds and Interviews go between Review and Decisions in whatever order and
// number the cycle needs. The setup page renders a tab per block, and delib
// boards find their round (columns, who qualifies) from here. Client-safe.

export type FixedKey = "setup" | "review" | "interviews" | "decisions";

export type PhaseBlock = { kind: "phase"; key: FixedKey; weeks: [number, number] };
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
      blocks.push({ kind: "phase", key: block.key, weeks: block.weeks });
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
 *  - at least one delib round; Interviews at most once;
 *  - Interviews sits right after a delib round (it decides who interviews)
 *    and has a delib round somewhere after it (to decide after interviews);
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
  const iv = middle.indexOf("interviews");
  if (iv !== -1) {
    if (middle.lastIndexOf("interviews") !== iv) return "A cycle has one Interviews phase.";
    if (middle[iv - 1] !== "delib") return "Interviews needs a delib round right before it.";
    if (!middle.slice(iv + 1).includes("delib")) return "Interviews needs a delib round after it.";
  }
  const ids = t.filter((b): b is DelibBlock => b.kind === "delib").map((b) => b.id);
  if (new Set(ids).size !== ids.length) return "Each delib round needs its own id.";
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
  return b.kind === "phase" ? PHASE_LABELS[b.key] : b.label;
}

/** A stable key per block: the phase key, or `delib:<id>`. */
export function blockKey(b: TimelineBlock): string {
  return b.kind === "phase" ? b.key : `delib:${b.id}`;
}

export function weeksLabel(b: { weeks: [number, number] }): string {
  const [a, z] = b.weeks;
  return a === z ? `Week ${a}` : `Week ${a}–${z}`;
}

export function hasInterviews(t: Timeline): boolean {
  return t.some((b) => b.kind === "phase" && b.key === "interviews");
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
    const leadsToInterviews = next?.kind === "phase" && next.key === "interviews";
    const isFinal = i === lastRoundAt;
    rounds.push({
      ...b,
      index: rounds.length,
      isFinal,
      leadsToInterviews,
      afterInterviews:
        rounds.length > 0 && sinceLastRound.some((x) => x.kind === "phase" && x.key === "interviews"),
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
