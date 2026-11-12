import type { ReferenceOption } from '~/forms/lib/reference-sources.shared'

// Inferred per-DomainApplication status — never stored, always derived.
export type DomainApplicationStatus =
  | 'ApplicationOpen'       // cycle is Open and application not yet submitted
  | 'Pending'               // submitted, no Released decision yet
  | 'Rejected'              // latest Released decision is Rejected
  | 'InvitedToInterview'    // Released InvitedToInterview, no interview scheduled
  | 'InterviewScheduled'    // interview exists with status Scheduled
  | 'PostInterviewPending'  // interview Completed, still on InvitedToInterview decision
  | 'Withdrawn'             // applicant cancelled their interview (withdrawal)
  | 'Accepted'              // latest Released decision is Accepted
  | 'AcceptedElsewhere'     // closed: applicant accepted into another domain this cycle
  | 'Waitlisted'            // latest Released decision is Waitlisted

export type DecisionType =
  | 'Rejected'
  | 'InvitedToInterview'
  | 'Accepted'
  | 'Waitlisted'

export type DecisionStage =
  | 'Draft'
  | 'Final'
  | 'Released'

export interface RubricCriterion {
  key: string
  label: string
  description?: string
  maxScore: number
}

export interface Question {
  key: string
  type:
    | 'text'
    | 'textarea'
    | 'select'
    // Single choice over `data.options`, shown as radio buttons. Same stored
    // answer as `select`.
    | 'radio'
    // Fixed 1 to 5 rating. Stored as "1" to "5".
    | 'scale'
    // Stored as YYYY-MM-DD.
    | 'date'
    // Stored as a numeric string, bounded by optional `data.min` / `data.max`.
    | 'number'
    // Stored trimmed and lowercased.
    | 'email'
    | 'github_url'
    | 'figma_url'
    | 'drive_url'
    | 'file'
    | 'skills_rating'
    // Multi-select over `data.options`. The stored answer is a string[] of
    // the selected option strings; fill UIs keep a JSON-stringified array in
    // their string-valued answer state and the server normalizes it (see
    // validateAnswers in app/forms/lib/public-form.ts).
    | 'checkbox'
    // A dropdown whose choices come from live DB data instead of a static
    // `options` list. The choices are resolved at fill time from the
    // server-side registry keyed by `data.referenceSource` (see
    // app/forms/lib/reference-sources.ts). The stored answer is the chosen
    // row's id (its `value`), not its label.
    | 'reference'
    // A non-question prose block rendered inline in the form (see `body`).
    | 'info'
    // A layout-only page divider. Splits the form into steps at render time;
    // carries no answer. `data.label` is the optional section title and
    // `data.description` the optional subtitle for the page it begins.
    | 'pageBreak'
  required: boolean
  data: {
    label: string
    description?: string
    options?: string[]
    // radio / checkbox only: adds a final "Other" choice whose typed text
    // (up to 200 characters) is stored as the answer.
    allowOther?: boolean
    // scale only: optional labels for the 1 and 5 ends.
    scaleLow?: string
    scaleHigh?: string
    // number only: optional bounds.
    min?: number
    max?: number
    afterDomains?: boolean
    accept?: string
    // file only: how many files one answer can hold (1 to 10, default 1).
    maxFiles?: number
    // file only: an answer needs exactly maxFiles files, not up to that many.
    exactFiles?: boolean
    maxWords?: number
    // Set only for `type: 'reference'`. A key into REFERENCE_SOURCES.
    referenceSource?: string
    // Set only for term-scoped reference sources (e.g.
    // 'projects:active-in-term'): the Term the form author chose to scope the
    // options to. Resolved at fill time by the loader; ignored by sources that
    // aren't term-scoped.
    referenceTermId?: string
    // A PREFILL_FIELDS key (app/forms/lib/prefill-fields.ts): the answer starts
    // as the filler's own record and stays editable.
    prefill?: string
    // Transient, editor preview only: who this question fills in for when it
    // didn't fill in for the person previewing.
    prefillHint?: string
    // Transient: populated by the server at fill time from the resolved
    // source (label shown, value = stored answer / DB id). Never persisted —
    // save-version rebuilds `data` and drops it. `projects:*` sources also
    // attach a `card` per option, which the fill UI renders instead of a
    // plain <select> row.
    referenceOptions?: ReferenceOption[]
    // For type === 'info': free-form prose rendered as a non-question text
    // block in the form. New rows store BlockNote block JSON; legacy rows are
    // ProseMirror JSON (old TipTap editor) or, before the rich-text upgrade,
    // a plain string — readers format-sniff all three.
    body?: unknown
    // Show this question (or, on a pageBreak, its whole page) only when
    // earlier answers match. See app/lib/form-logic.ts.
    showIf?: ShowIfRule
  }
}

export type ShowIfOp =
  | 'is'
  | 'isNot'
  | 'includes'
  | 'excludes'
  | 'atLeast'
  | 'atMost'
  | 'contains'
  | 'answered'
  | 'blank'

export interface ShowIfCondition {
  questionKey: string
  op: ShowIfOp
  values?: string[]
  // Rules saved before any-of held one value here; read as values: [value].
  value?: string
  // reference sources only: the picked rows' labels, for the sentences.
  labels?: string[]
}

export type ShowIfRule =
  | ShowIfCondition
  | { match: 'all' | 'any'; conditions: ShowIfCondition[] }
