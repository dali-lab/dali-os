export type ApplicationStatus =
  | 'Draft'
  | 'Submitted'
  | 'Withdrawn'
  | 'Rejected'
  | 'InterviewInvited'
  | 'InterviewScheduled'
  | 'InterviewCompleted'
  | 'PostInterviewRejected'
  | 'Offered'
  | 'OfferAccepted'
  | 'OfferDeclined'
  | 'OfferDeferred'
  | 'InterviewDeclined'
  | 'FeedbackRequested'

export type ApplicationCycleStatus =
  | 'Draft'
  | 'Open'
  | 'UnderReview'
  | 'DecisionsReleased'

export type CycleStage =
  | 'challengeSetup'
  | 'challengesReady'
  | 'applicationsOpen'
  | 'readingApplications'
  | 'writtenDelibs'
  | 'collectingAvailability'
  | 'interviews'
  | 'finalDelibs'

export type ViewMode = 'applicant' | 'mentor' | 'domainLead' | 'admin'

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
  domainId?: string // Optional: if absent, it's a general rubric
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

export interface ApplicationFormVersion {
  id: string
  versionNumber: number
  createdAt: string
  createdById: string
  questions: Question[]
}

export type ChallengeType = 'General' | 'UI/UX' | 'Fullstack' | 'Data' | 'AR/VR' | 'PM' | 'Engines'

export interface ApplicationForm {
  id: string
  name: string
  type: ChallengeType
  createdAt: string
  versions: ApplicationFormVersion[]
}

export interface ChallengeVersion {
  id: string
  domainId: string
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
  id: string
  startTime: string
  endTime: string
}

export interface Interview {
  id: string
  applicationId: string
  availableSlots: InterviewSlot[]
  scheduledSlotId?: string
  status: 'Pending' | 'Scheduled' | 'Completed' | 'Cancelled' | 'Declined'
  location?: string
  notes?: string
}

export interface MentorReview {
  id: string
  applicationId: string
  mentorId: string
  scores: Record<string, number> // e.g., { 'technical': 4, 'design': 3 }
  feedback: string
  rejectionRationale?: string
  overallRecommendation:
    | 'Strong Hire'
    | 'Hire'
    | 'Lean Hire'
    | 'Lean No Hire'
    | 'No Hire'
    | null
  createdAt: string
  updatedAt: string
}

export interface Application {
  id: string
  userId: string
  applicationCycleId: string
  applicationFormVersionId: string
  status: ApplicationStatus
  answers: Record<string, string>
  domainApplications: DomainApplication[]
  interview?: Interview
  feedbackRequested?: boolean
  offerResponse?: 'Accepted' | 'Declined' | 'Deferred'
  assignedMentorId?: string
  mentorReviews?: MentorReview[]
  createdAt: string
  updatedAt: string
}