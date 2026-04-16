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
  type: 'text' | 'textarea' | 'select'
  required: boolean
  data: {
    label: string
    description?: string
    options?: string[]
    showForRoles?: string[]
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
