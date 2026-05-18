export type ApplicationStatus =
  | 'Draft'
  | 'Submitted'
  | 'Withdrawn'

export type ApplicationCycleStatus =
  | 'Draft'
  | 'Open'
  | 'UnderReview'
  | 'Completed'

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

export type DelibsType = 'Initial' | 'Final'
export type DelibsStatus = 'Active' | 'Closed'

export type OverallRecommendation =
  | 'Strong Hire'
  | 'Hire'
  | 'Lean Hire'
  | 'Lean No Hire'
  | 'No Hire'

export interface User {
  id: string
  firstName: string
  lastName: string
  netId?: string
  daliEmail?: string
  dartmouthEmail?: string
  isDaliMember?: boolean
}

export interface ApplicationCycle {
  id: string
  name: string
  status: ApplicationCycleStatus
  createdAt: string
  closeDate?: string
  activeFormVersionId?: string
  activeChallengeVersionIds?: Record<string, string>
  activeGeneralRubricVersionId?: string
  activeDomainRubricVersionIds?: Record<string, string>
}

export interface Domain {
  id: string
  name: string
}

export interface RubricCriterion {
  key: string
  label: string
  description?: string
  maxScore: number
}

export interface RubricVersion {
  id: string
  versionNumber: number
  createdAt: string
  createdById: string
  criteria: RubricCriterion[]
  domainId?: string
}

export interface Rubric {
  id: string
  name: string
  createdAt: string
  versions: RubricVersion[]
}

export interface Question {
  key: string
  type:
    | 'text'
    | 'textarea'
    | 'select'
    | 'github_url'
    | 'figma_url'
    | 'drive_url'
    | 'file'
    | 'skills_rating'
    // A dropdown whose choices come from live DB data instead of a static
    // `options` list. The choices are resolved at fill time from the
    // server-side registry keyed by `data.referenceSource` (see
    // app/forms/lib/reference-sources.ts). The stored answer is the chosen
    // row's id (its `value`), not its label.
    | 'reference'
    // A non-question prose block rendered inline in the form (see `body`).
    | 'info'
  required: boolean
  data: {
    label: string
    description?: string
    options?: string[]
    afterDomains?: boolean
    accept?: string
    maxWords?: number
    // Set only for `type: 'reference'`. A key into REFERENCE_SOURCES.
    referenceSource?: string
    // Transient: populated by the server at fill time from the resolved
    // source (label shown, value = stored answer / DB id). Never persisted —
    // save-version rebuilds `data` and drops it.
    referenceOptions?: { value: string; label: string }[]
    // For type === 'info': free-form prose rendered as a non-question text
    // block in the form. Plain text; line breaks preserved.
    body?: string
  }
}

export type ChallengeType = 'General' | 'UI/UX' | 'Fullstack' | 'Data' | 'AR/VR' | 'PM' | 'Engines'

export interface ChallengeVersion {
  id: string
  domainId: string | null
  versionNumber: number
  createdAt: string
  createdById: string
  questions: Question[]
  // ProseMirror JSON document (Tiptap StarterKit). Null/undefined for versions
  // created before #273.
  description?: unknown
}

export interface Challenge {
  id: string
  name: string
  createdAt: string
  versions: ChallengeVersion[]
}

export interface DomainApplication {
  id: string
  applicationId: string
  challengeVersionId: string
  answers: Record<string, string>
}

export interface InterviewSlot {
  startTime: string
  endTime: string
}

export interface Interview {
  id: string
  domainApplicationId: string
  applicationCycleId: string
  startTime: string
  endTime: string
  status: 'Scheduled' | 'Completed' | 'CancelledByApplicant' | 'CancelledByAdmin'
  recommendation?: OverallRecommendation
  recommendationNotes?: string
}

export interface ApplicationReview {
  id: string
  domainApplicationId: string
  cycleReviewerId: string
  scores: Record<string, number>
  feedback: string
  rejectionRationale: string
  overallRecommendation: OverallRecommendation | null
  annotations: Array<{ id: string; fieldKey: string; start: number; end: number; comment: string; color: string }>
  submittedAt: string | null
  submittedById: string | null
  createdAt: string
  updatedAt: string
}

export interface Decision {
  id: string
  domainApplicationId: string
  type: DecisionType
  stage: DecisionStage
  madeById: string
  notes?: string
  waitlistRank?: number
  createdAt: string
}

export interface DelibsSession {
  id: string
  domainId: string
  applicationCycleId: string
  type: DelibsType
  status: DelibsStatus
  columnOrder: Record<string, string[]>
  openedById: string
  createdAt: string
  updatedAt: string
}

export interface CycleReviewer {
  id: string
  daliMemberId: string
  applicationCycleId: string
  domainId: string
}

export interface CycleInterviewer {
  id: string
  daliMemberId: string
  applicationCycleId: string
  domainId: string
}

export interface InterviewNoteVersion {
  id: string
  interviewAssignmentId: string
  content: string
  createdAt: string
}

export interface Application {
  id: string
  userId: string
  applicationCycleId: string
  generalChallengeVersionId: string
  status: ApplicationStatus
  answers: Record<string, string>
  domainApplications: DomainApplication[]
  createdAt: string
  updatedAt: string
}
