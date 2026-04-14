import React, { useState, createContext, useContext } from 'react'
import type { Application } from '../types'
import { mockApplications } from '../mockData'
import type { MentorReview } from '../types'
interface ApplicationsContextType {
  applications: Application[]
  getApplicationForCycle: (
    userId: string,
    cycleId: string,
  ) => Application | undefined
  upsertApplication: (app: Application) => void
  updateApplicationAnswers: (
    appId: string,
    answers: Record<string, string>,
  ) => void
  updateApplicationDomains: (
    appId: string,
    domainApplications: Application['domainApplications'],
  ) => void
  submitApplication: (appId: string) => void
  updateApplicationStatus: (
    appId: string,
    status: Application['status'],
  ) => void
  scheduleInterview: (appId: string, slotId: string) => void
  cancelInterview: (appId: string) => void
  declineInterview: (appId: string) => void
  requestFeedback: (appId: string) => void
  respondToOffer: (
    appId: string,
    response: 'Accepted' | 'Declined' | 'Deferred',
  ) => void
  saveMentorReview: (
    appId: string,
    review: Omit<MentorReview, 'id' | 'createdAt' | 'updatedAt'>,
  ) => void
  saveInterviewNotes: (appId: string, notes: string) => void
}
const ApplicationsContext = createContext<ApplicationsContextType>({
  applications: mockApplications,
  getApplicationForCycle: () => undefined,
  upsertApplication: () => {},
  updateApplicationAnswers: () => {},
  updateApplicationDomains: () => {},
  submitApplication: () => {},
  updateApplicationStatus: () => {},
  scheduleInterview: () => {},
  cancelInterview: () => {},
  declineInterview: () => {},
  requestFeedback: () => {},
  respondToOffer: () => {},
  saveMentorReview: () => {},
  saveInterviewNotes: () => {},
})
export function useApplications() {
  return useContext(ApplicationsContext)
}
export function ApplicationsProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [applications, setApplications] =
    useState<Application[]>(mockApplications)
  const getApplicationForCycle = (userId: string, cycleId: string) => {
    return applications.find(
      (a) => a.userId === userId && a.applicationCycleId === cycleId,
    )
  }
  const upsertApplication = (app: Application) => {
    setApplications((prev) => {
      const idx = prev.findIndex((a) => a.id === app.id)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = app
        return updated
      }
      return [...prev, app]
    })
  }
  const updateApplicationAnswers = (
    appId: string,
    answers: Record<string, string>,
  ) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === appId
          ? {
              ...a,
              answers,
              updatedAt: new Date().toISOString(),
            }
          : a,
      ),
    )
  }
  const updateApplicationDomains = (
    appId: string,
    domainApplications: Application['domainApplications'],
  ) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === appId
          ? {
              ...a,
              domainApplications,
              updatedAt: new Date().toISOString(),
            }
          : a,
      ),
    )
  }
  const submitApplication = (appId: string) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === appId
          ? {
              ...a,
              status: 'Submitted' as const,
              updatedAt: new Date().toISOString(),
            }
          : a,
      ),
    )
  }
  const updateApplicationStatus = (
    appId: string,
    status: Application['status'],
  ) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === appId
          ? {
              ...a,
              status,
              updatedAt: new Date().toISOString(),
            }
          : a,
      ),
    )
  }
  const scheduleInterview = (appId: string, slotId: string) => {
    setApplications((prev) =>
      prev.map((a) => {
        if (a.id === appId && a.interview) {
          return {
            ...a,
            status: 'InterviewScheduled',
            interview: {
              ...a.interview,
              status: 'Scheduled',
              scheduledSlotId: slotId,
            },
            updatedAt: new Date().toISOString(),
          }
        }
        return a
      }),
    )
  }
  const cancelInterview = (appId: string) => {
    setApplications((prev) =>
      prev.map((a) => {
        if (a.id === appId && a.interview) {
          return {
            ...a,
            status: 'InterviewInvited',
            interview: {
              ...a.interview,
              status: 'Pending',
              scheduledSlotId: undefined,
            },
            updatedAt: new Date().toISOString(),
          }
        }
        return a
      }),
    )
  }
  const declineInterview = (appId: string) => {
    setApplications((prev) =>
      prev.map((a) => {
        if (a.id === appId && a.interview) {
          return {
            ...a,
            status: 'InterviewDeclined',
            interview: {
              ...a.interview,
              status: 'Declined',
              scheduledSlotId: undefined,
            },
            updatedAt: new Date().toISOString(),
          }
        }
        return a
      }),
    )
  }
  const requestFeedback = (appId: string) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === appId
          ? {
              ...a,
              status: 'FeedbackRequested',
              feedbackRequested: true,
              updatedAt: new Date().toISOString(),
            }
          : a,
      ),
    )
  }
  const respondToOffer = (
    appId: string,
    response: 'Accepted' | 'Declined' | 'Deferred',
  ) => {
    setApplications((prev) =>
      prev.map((a) =>
        a.id === appId
          ? {
              ...a,
              status: `Offer${response}` as Application['status'],
              offerResponse: response,
              updatedAt: new Date().toISOString(),
            }
          : a,
      ),
    )
  }
  const saveMentorReview = (
    appId: string,
    reviewData: Omit<MentorReview, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    setApplications((prev) =>
      prev.map((a) => {
        if (a.id === appId) {
          const newReview: MentorReview = {
            ...reviewData,
            id: `rev-${Date.now()}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          const existingReviews = a.mentorReviews || []
          const updatedReviews = existingReviews.filter(
            (r) => r.mentorId !== reviewData.mentorId,
          )
          return {
            ...a,
            mentorReviews: [...updatedReviews, newReview],
            updatedAt: new Date().toISOString(),
          }
        }
        return a
      }),
    )
  }
  const saveInterviewNotes = (appId: string, notes: string) => {
    setApplications((prev) =>
      prev.map((a) => {
        if (a.id === appId && a.interview) {
          return {
            ...a,
            interview: {
              ...a.interview,
              notes,
            },
            updatedAt: new Date().toISOString(),
          }
        }
        return a
      }),
    )
  }
  return (
    <ApplicationsContext.Provider
      value={{
        applications,
        getApplicationForCycle,
        upsertApplication,
        updateApplicationAnswers,
        updateApplicationDomains,
        submitApplication,
        updateApplicationStatus,
        scheduleInterview,
        cancelInterview,
        declineInterview,
        requestFeedback,
        respondToOffer,
        saveMentorReview,
        saveInterviewNotes,
      }}
    >
      {children}
    </ApplicationsContext.Provider>
  )
}
