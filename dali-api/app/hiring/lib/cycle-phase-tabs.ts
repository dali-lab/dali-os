import { blockDates, phaseStatus, tasksForBlock, type PhaseStatus } from "./cycle-phases";
import { blockKey, blockLabel, delibRounds, type Timeline, type TimelineBlock } from "./cycle-timeline";

// The cycle setup page's tabs are the cycle's timeline blocks, in order.
// Client-safe.

export type PhaseTab = {
  /** blockKey: the phase key, or `delib:<id>` for a round. */
  key: string;
  label: string;
  block: TimelineBlock;
  weeks: [number, number];
  status: PhaseStatus;
  dates: { start: Date; end: Date } | null;
  tasks: { key: string; label: string; done: boolean }[];
};

/** Each block with its dated window, task checklist and status. */
export function buildPhaseTabs(
  timeline: Timeline,
  opts: { hasChallenges: boolean },
  done: Record<string, boolean>,
  termStart: Date | null,
  now: Date = new Date(),
): PhaseTab[] {
  return timeline.map((block) => {
    const tasks = tasksForBlock(timeline, block, opts).map((t) => ({ ...t, done: !!done[t.key] }));
    const dates = termStart ? blockDates(termStart, block.weeks) : null;
    return {
      key: blockKey(block),
      label: blockLabel(block),
      block,
      weeks: block.weeks,
      tasks,
      dates,
      status: phaseStatus(tasks.map((t) => t.done), dates, now),
    };
  });
}

/** The tab to land on: the one running now by date, else the first that
 *  isn't done (an undated cycle, or one whose current block is finished). */
export function defaultPhase(tabs: PhaseTab[]): string {
  const current = tabs.find((t) => t.status === "current");
  if (current) return current.key;
  return (tabs.find((t) => t.status !== "done") ?? tabs[tabs.length - 1]).key;
}

/** Resolve ?tab= to one of this cycle's tabs. Ids from older layouts of the
 *  page map onto their closest block so bookmarks keep landing somewhere. */
export function resolvePhaseTab(param: string | null | undefined, tabs: PhaseTab[], timeline: Timeline): string {
  const rounds = delibRounds(timeline);
  const legacy: Record<string, string | undefined> = {
    overview: "setup",
    reviewers: "review",
    team: "review",
    config: "interviews",
    dashboard: "interviews",
    final: rounds.length ? `delib:${rounds[rounds.length - 1].id}` : undefined,
  };
  const key = param ? (legacy[param] ?? param) : null;
  return tabs.find((t) => t.key === key)?.key ?? defaultPhase(tabs);
}
