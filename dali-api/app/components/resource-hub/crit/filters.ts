import type { CritSubmissionView } from "./SubmissionOverlay";

export const CRIT_FILTERS = [
  { value: "all", label: "All work", keep: () => true },
  { value: "mine", label: "Mine", keep: (i: CritSubmissionView) => i.mine },
  { value: "needs-feedback", label: "Needs feedback", keep: (i: CritSubmissionView) => i.commentCount === 0 },
] as const;

export type CritFilter = (typeof CRIT_FILTERS)[number]["value"];
