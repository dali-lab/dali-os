
export type DecisionSlice = 'invites' | 'finalize' | 'outcomes'

// `invites` only renders on the round tab that hands off to Interviews, so
// `outcomes` on the Decisions tab takes every Final: an invite finalized after
// the lead has moved past that round would otherwise be releasable nowhere.
export const DECISION_SLICES: Record<DecisionSlice, { title: string; empty: string; include: (d: any) => boolean }> = {
  invites: {
    title: 'Interview invites',
    empty: 'No invites ready to send.',
    include: (d) => d.stage === 'Final' && d.type === 'InvitedToInterview',
  },
  finalize: {
    title: 'Draft decisions',
    empty: 'No drafts to finalize. Close final delibs to create them.',
    include: (d) => d.stage === 'Draft',
  },
  outcomes: {
    title: 'Decisions ready to release',
    empty: 'No decisions awaiting release.',
    include: (d) => d.stage === 'Final',
  },
}
