-- Add interview-specific notification types for template-based email sends.
ALTER TYPE "NotificationType" ADD VALUE 'InterviewConfirmedApplicant';
ALTER TYPE "NotificationType" ADD VALUE 'InterviewCancelledApplicant';
ALTER TYPE "NotificationType" ADD VALUE 'InterviewCancelledInterviewer';
ALTER TYPE "NotificationType" ADD VALUE 'InterviewLocationChanged';
