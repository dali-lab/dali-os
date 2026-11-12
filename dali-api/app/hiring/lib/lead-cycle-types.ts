import type { InterviewerAvailability } from "~/hiring/lib/interviewer-pool";
import type { LeadCycleData } from "~/hiring/lib/lead-cycle.server";

export interface InterviewConfig {
  id?: string
  slotDurationMinutes: number
  bufferMinutes: number
  dayStartHour: number
  dayEndHour: number
  interviewStartDate: string
  interviewEndDate: string
  rescheduleNoticeHours: number
  cancelNoticeHours: number
  bookingNoticeHours: number
  timezone: string
  rooms?: { id: string; name: string }[]
  roomIds: string[]
  holdRooms: boolean
}

export interface RoomHoldConflictItem {
  kind: 'booking' | 'meeting'
  id: string
  title: string
  start: string
  end: string
  organizer: { firstName: string | null; lastName: string | null }
  recurring: boolean
}

export interface RoomHoldConflict {
  roomId: string
  roomName: string
  items: RoomHoldConflictItem[]
}

export interface CycleReviewer {
  id: string
  userId?: string
  domainId?: string
  user: { 
    id: string
    firstName: string | null
    lastName: string | null
    daliEmail: string | null
   }
  domain: { id: string; name: string }
}

export const AVAILABILITY_ORDER: InterviewerAvailability[] = ['free', 'busy', 'no-calendar', 'booked']
export const AVAILABILITY_NOTE: Record<InterviewerAvailability, string | undefined> = {
  free: undefined,
  busy: 'Busy on their calendar',
  'no-calendar': 'No calendar set up',
  booked: 'Has another interview then',
}

export interface InterviewRow {
  id: string
  startTime: string
  endTime: string
  status: string
  availability: Record<string, InterviewerAvailability>
  room: { id: string; name: string } | null
  zoomJoinUrl: string | null
  videoUrl: string | null
  domainApplication: {
    id: string
    domainId: string
    domain: { name: string }
    application: { user: { firstName: string; lastName: string } }
  }
  assignments: {
    id: string
    role: 'InDomain' | 'CrossDomain'
    status: string
    cycleInterviewer: {
      userId: string
      user: {  firstName: string | null; lastName: string | null; daliEmail: string | null  }
      domain: { name: string }
    }
  }[]
}

export interface PendingInviteRow {
  id: string
  invitedAt: string
  withdrawn: boolean
  domainApplication: {
    id: string
    domain: { name: string }
    application: { user: { id: string; firstName: string | null; lastName: string | null } }
  }
}

export type LeadCycle = LeadCycleData["cycle"];
export type LeadCycleDomain = LeadCycle["domains"][number];
export type PendingDecision = LeadCycleData["pendingDecisions"][number];
export type RubricVersionOption = LeadCycleData["rubricVersionOptions"][number];
export type CycleForm = LeadCycleData["allForms"][number];

export interface CycleInterviewer {
  id: string
  userId: string
  domainId: string
  user: { firstName: string | null; lastName: string | null; daliEmail: string | null } | null
  domain: { id: string; name: string } | null
  availabilityHours?: number
  availabilityBlockCount?: number
  hasCalendar?: boolean
}

export type InterviewAssignmentRow = InterviewRow["assignments"][number];
