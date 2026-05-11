
-- CreateEnum
CREATE TYPE "ApplicationType" AS ENUM ('Standard', 'Intern', 'InternToFull', 'Transfer');

-- CreateEnum
CREATE TYPE "Season" AS ENUM ('W', 'S', 'X', 'F');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('Project', 'Core', 'Instructor', 'DomainLead', 'Admin');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('Active', 'Paused', 'Archived');

-- CreateEnum
CREATE TYPE "EpicStatus" AS ENUM ('Open', 'InProgress', 'Done', 'Cancelled');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('Planned', 'Active', 'Closed');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('Todo', 'InProgress', 'InReview', 'Done', 'Cancelled');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('Low', 'Normal', 'High', 'Urgent');

-- CreateEnum
CREATE TYPE "OfferingType" AS ENUM ('Miniseries', 'Workshop');

-- CreateEnum
CREATE TYPE "OfferingStatus" AS ENUM ('Draft', 'Published', 'Archived');

-- CreateEnum
CREATE TYPE "EduApplicationStatus" AS ENUM ('Submitted', 'Approved', 'Rejected', 'Waitlisted', 'Withdrawn');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('Present', 'Absent', 'Excused');

-- CreateEnum
CREATE TYPE "SubmissionType" AS ENUM ('Text', 'File', 'Mixed');

-- CreateEnum
CREATE TYPE "StaffingStatus" AS ENUM ('Draft', 'OpenToCoreFirst', 'OpenToMembers', 'Assigning', 'Closed');

-- CreateEnum
CREATE TYPE "EssentialityLevel" AS ENUM ('Critical', 'Important', 'NiceToHave', 'NotNeeded');

-- CreateEnum
CREATE TYPE "CalProvider" AS ENUM ('Google', 'Outlook');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('Project', 'Group', 'UserList', 'Series', 'None');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('Searching', 'Confirmed', 'Cancelled');

-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('Static', 'Dynamic');

-- CreateEnum
CREATE TYPE "WorkspaceType" AS ENUM ('Lab', 'Project', 'EducationOffering');

-- CreateEnum
CREATE TYPE "PageKind" AS ENUM ('FreeForm', 'Structured');

-- CreateEnum
CREATE TYPE "DigestFreq" AS ENUM ('Instant', 'Daily', 'Weekly', 'Off');

-- CreateEnum
CREATE TYPE "PartnerAuthProvider" AS ENUM ('MagicLink', 'Google');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssignmentStatus" ADD VALUE 'Proposed';
ALTER TYPE "AssignmentStatus" ADD VALUE 'Confirmed';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "applicationType" "ApplicationType" NOT NULL DEFAULT 'Standard';

-- AlterTable
ALTER TABLE "Domain" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "isInternProgram" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DomainLeadAssignment" ADD COLUMN     "termId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bioDocId" TEXT,
ADD COLUMN     "classYear" INTEGER,
ADD COLUMN     "githubUrl" TEXT,
ADD COLUMN     "graduatedAt" TIMESTAMP(3),
ADD COLUMN     "hometown" TEXT,
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "major" TEXT,
ADD COLUMN     "personalSite" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "pronouns" TEXT,
ADD COLUMN     "timeZone" TEXT;

-- CreateTable
CREATE TABLE "Term" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "season" "Season" NOT NULL,
    "sortKey" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainEligibility" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "promotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedBy" TEXT,

    CONSTRAINT "DomainEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentorshipPair" (
    "id" TEXT NOT NULL,
    "menteeUserId" TEXT NOT NULL,
    "mentorUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,

    CONSTRAINT "MentorshipPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "leadTitle" TEXT,

    CONSTRAINT "CoreAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,

    CONSTRAINT "InstructorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "AdminMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobCodeLookup" (
    "id" TEXT NOT NULL,
    "assignmentType" "AssignmentType" NOT NULL,
    "level" "Level",
    "domainId" TEXT,
    "jobCode" TEXT NOT NULL,
    "payRateUsdHour" DECIMAL(65,30),
    "notes" TEXT,

    CONSTRAINT "JobCodeLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calendarEmail" TEXT,
    "firstTermId" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'Active',
    "overviewPageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTermStatus" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "isContinuing" BOOLEAN NOT NULL,
    "setBy" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTermStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Epic" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionDocId" TEXT,
    "status" "EpicStatus" NOT NULL DEFAULT 'Open',
    "targetTermId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Epic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "goalDocId" TEXT,
    "status" "SprintStatus" NOT NULL DEFAULT 'Planned',

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "epicId" TEXT,
    "title" TEXT NOT NULL,
    "descriptionDocId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'Todo',
    "priority" "Priority" NOT NULL DEFAULT 'Normal',
    "position" INTEGER NOT NULL DEFAULT 0,
    "checklist" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationOffering" (
    "id" TEXT NOT NULL,
    "type" "OfferingType" NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionDocId" TEXT,
    "capacity" INTEGER NOT NULL,
    "registrationOpensAt" TIMESTAMP(3) NOT NULL,
    "registrationClosesAt" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "OfferingStatus" NOT NULL DEFAULT 'Draft',
    "requiresReview" BOOLEAN NOT NULL,
    "calendarEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EducationOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationSession" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "materialsDocId" TEXT,
    "recordingUrl" TEXT,

    CONSTRAINT "EducationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationApplication" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "status" "EduApplicationStatus" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "EducationApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationApplicationQuestion" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EducationApplicationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationApplicationAnswer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "EducationApplicationAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationAttendance" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,

    CONSTRAINT "EducationAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationAssignment" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT,
    "sessionId" TEXT,
    "title" TEXT NOT NULL,
    "instructionsDocId" TEXT,
    "dueAt" TIMESTAMP(3),
    "submissionType" "SubmissionType" NOT NULL,

    CONSTRAINT "EducationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationSubmission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "contentDocId" TEXT,
    "files" JSONB,
    "submittedAt" TIMESTAMP(3),
    "gradedAt" TIMESTAMP(3),
    "feedbackDocId" TEXT,

    CONSTRAINT "EducationSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationAnnouncement" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EducationAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingCycle" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "maxPreferencesPerMember" INTEGER NOT NULL DEFAULT 3,
    "status" "StaffingStatus" NOT NULL DEFAULT 'Draft',

    CONSTRAINT "StaffingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRoleRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "slots" INTEGER NOT NULL,
    "notesDocId" TEXT,

    CONSTRAINT "ProjectRoleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "preferenceRank" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "StaffingPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EssentialityForm" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "pmUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "EssentialityForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EssentialityRating" (
    "id" TEXT NOT NULL,
    "essentialityFormId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" "EssentialityLevel" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "EssentialityRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffingAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "level" "Level" NOT NULL,
    "status" "AssignmentStatus" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,

    CONSTRAINT "StaffingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCalendarLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "CalProvider" NOT NULL,
    "externalEmail" TEXT NOT NULL,
    "oauthTokens" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT true,
    "subCalendarIds" TEXT[],
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCalendarLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMeeting" (
    "id" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionDocId" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" TEXT,
    "participantUserIds" TEXT[],
    "selectedAt" TIMESTAMP(3),
    "externalEventId" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'Searching',
    "recurrenceRule" TEXT,
    "ownerCalendarEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GroupType" NOT NULL,
    "dynamicQuery" TEXT,
    "staticMemberIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingException" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "originalStart" TIMESTAMP(3) NOT NULL,
    "overrideStart" TIMESTAMP(3),
    "overrideDurationMin" INTEGER,
    "overrideTitle" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MeetingException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "workspaceType" "WorkspaceType" NOT NULL,
    "workspaceId" TEXT,
    "parentPageId" TEXT,
    "title" TEXT NOT NULL,
    "kind" "PageKind" NOT NULL DEFAULT 'FreeForm',
    "contentDocId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "iconEmoji" TEXT,
    "coverImageUrl" TEXT,
    "lastEditedById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workspaceTypes" "WorkspaceType"[],
    "contentDocId" TEXT NOT NULL,
    "iconEmoji" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentorNote" (
    "id" TEXT NOT NULL,
    "mentorId" TEXT NOT NULL,
    "menteeId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "contentDocId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentorNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentorNoteTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentDocId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentorNoteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "inAppDelivered" BOOLEAN NOT NULL DEFAULT false,
    "emailDelivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "digestFrequency" "DigestFreq" NOT NULL DEFAULT 'Instant',

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerOrg" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "website" TEXT,
    "primaryContactId" TEXT,
    "isIndividual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerUser" (
    "id" TEXT NOT NULL,
    "partnerOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayRole" TEXT,
    "authProvider" "PartnerAuthProvider" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPartner" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "partnerOrgId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectPartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Term_code_key" ON "Term"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Term_sortKey_key" ON "Term"("sortKey");

-- CreateIndex
CREATE INDEX "Term_sortKey_idx" ON "Term"("sortKey");

-- CreateIndex
CREATE UNIQUE INDEX "DomainEligibility_userId_domainId_key" ON "DomainEligibility"("userId", "domainId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_userId_termId_idx" ON "ProjectAssignment"("userId", "termId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_projectId_termId_idx" ON "ProjectAssignment"("projectId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectAssignment_userId_projectId_termId_domainId_key" ON "ProjectAssignment"("userId", "projectId", "termId", "domainId");

-- CreateIndex
CREATE UNIQUE INDEX "MentorshipPair_menteeUserId_projectId_termId_domainId_key" ON "MentorshipPair"("menteeUserId", "projectId", "termId", "domainId");

-- CreateIndex
CREATE INDEX "CoreAssignment_userId_termId_idx" ON "CoreAssignment"("userId", "termId");

-- CreateIndex
CREATE INDEX "CoreAssignment_termId_leadTitle_idx" ON "CoreAssignment"("termId", "leadTitle");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorAssignment_userId_offeringId_key" ON "InstructorAssignment"("userId", "offeringId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminMembership_userId_key" ON "AdminMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_overviewPageId_key" ON "Project"("overviewPageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTermStatus_projectId_termId_key" ON "ProjectTermStatus"("projectId", "termId");

-- CreateIndex
CREATE INDEX "Sprint_projectId_status_idx" ON "Sprint"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_projectId_sprintId_idx" ON "Task"("projectId", "sprintId");

-- CreateIndex
CREATE INDEX "EducationSession_offeringId_sequence_idx" ON "EducationSession"("offeringId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "EducationApplication_studentId_offeringId_key" ON "EducationApplication"("studentId", "offeringId");

-- CreateIndex
CREATE INDEX "EducationApplicationQuestion_offeringId_position_idx" ON "EducationApplicationQuestion"("offeringId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "EducationApplicationAnswer_applicationId_questionId_key" ON "EducationApplicationAnswer"("applicationId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "EducationAttendance_applicationId_sessionId_key" ON "EducationAttendance"("applicationId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "EducationSubmission_assignmentId_studentId_key" ON "EducationSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "ProjectRoleRequest_projectId_termId_idx" ON "ProjectRoleRequest"("projectId", "termId");

-- CreateIndex
CREATE INDEX "StaffingPreference_staffingCycleId_userId_idx" ON "StaffingPreference"("staffingCycleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingPreference_userId_staffingCycleId_projectId_domainI_key" ON "StaffingPreference"("userId", "staffingCycleId", "projectId", "domainId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "EssentialityForm_projectId_staffingCycleId_key" ON "EssentialityForm"("projectId", "staffingCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "EssentialityRating_essentialityFormId_userId_key" ON "EssentialityRating"("essentialityFormId", "userId");

-- CreateIndex
CREATE INDEX "StaffingAssignment_userId_termId_idx" ON "StaffingAssignment"("userId", "termId");

-- CreateIndex
CREATE INDEX "StaffingAssignment_projectId_termId_idx" ON "StaffingAssignment"("projectId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCalendarLink_userId_key" ON "UserCalendarLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingException_scheduledMeetingId_originalStart_key" ON "MeetingException"("scheduledMeetingId", "originalStart");

-- CreateIndex
CREATE INDEX "Page_workspaceType_workspaceId_parentPageId_idx" ON "Page"("workspaceType", "workspaceId", "parentPageId");

-- CreateIndex
CREATE INDEX "Page_archivedAt_idx" ON "Page"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MentorNote_mentorId_menteeId_projectId_termId_domainId_week_key" ON "MentorNote"("mentorId", "menteeId", "projectId", "termId", "domainId", "weekOf");

-- CreateIndex
CREATE INDEX "NotificationEvent_recipientId_readAt_idx" ON "NotificationEvent"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "NotificationEvent_recipientId_createdAt_idx" ON "NotificationEvent"("recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_key" ON "NotificationPreference"("userId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerUser_email_key" ON "PartnerUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPartner_projectId_partnerOrgId_key" ON "ProjectPartner"("projectId", "partnerOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_code_key" ON "Domain"("code");

-- CreateIndex
CREATE INDEX "DomainLeadAssignment_domainId_termId_idx" ON "DomainLeadAssignment"("domainId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "DomainLeadAssignment_memberId_domainId_termId_key" ON "DomainLeadAssignment"("memberId", "domainId", "termId");

-- AddForeignKey
ALTER TABLE "DomainEligibility" ADD CONSTRAINT "DomainEligibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEligibility" ADD CONSTRAINT "DomainEligibility_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAssignment" ADD CONSTRAINT "ProjectAssignment_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorshipPair" ADD CONSTRAINT "MentorshipPair_menteeUserId_fkey" FOREIGN KEY ("menteeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorshipPair" ADD CONSTRAINT "MentorshipPair_mentorUserId_fkey" FOREIGN KEY ("mentorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorshipPair" ADD CONSTRAINT "MentorshipPair_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorshipPair" ADD CONSTRAINT "MentorshipPair_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorshipPair" ADD CONSTRAINT "MentorshipPair_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainLeadAssignment" ADD CONSTRAINT "DomainLeadAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreAssignment" ADD CONSTRAINT "CoreAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreAssignment" ADD CONSTRAINT "CoreAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAssignment" ADD CONSTRAINT "InstructorAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAssignment" ADD CONSTRAINT "InstructorAssignment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorAssignment" ADD CONSTRAINT "InstructorAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminMembership" ADD CONSTRAINT "AdminMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_overviewPageId_fkey" FOREIGN KEY ("overviewPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTermStatus" ADD CONSTRAINT "ProjectTermStatus_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTermStatus" ADD CONSTRAINT "ProjectTermStatus_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Epic" ADD CONSTRAINT "Epic_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationSession" ADD CONSTRAINT "EducationSession_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationApplication" ADD CONSTRAINT "EducationApplication_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationApplication" ADD CONSTRAINT "EducationApplication_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationApplicationQuestion" ADD CONSTRAINT "EducationApplicationQuestion_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationApplicationAnswer" ADD CONSTRAINT "EducationApplicationAnswer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "EducationApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationApplicationAnswer" ADD CONSTRAINT "EducationApplicationAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "EducationApplicationQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationAttendance" ADD CONSTRAINT "EducationAttendance_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "EducationApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationAttendance" ADD CONSTRAINT "EducationAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EducationSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationAssignment" ADD CONSTRAINT "EducationAssignment_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationAssignment" ADD CONSTRAINT "EducationAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EducationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationSubmission" ADD CONSTRAINT "EducationSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "EducationAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationAnnouncement" ADD CONSTRAINT "EducationAnnouncement_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingCycle" ADD CONSTRAINT "StaffingCycle_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRoleRequest" ADD CONSTRAINT "ProjectRoleRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRoleRequest" ADD CONSTRAINT "ProjectRoleRequest_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRoleRequest" ADD CONSTRAINT "ProjectRoleRequest_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingPreference" ADD CONSTRAINT "StaffingPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingPreference" ADD CONSTRAINT "StaffingPreference_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EssentialityForm" ADD CONSTRAINT "EssentialityForm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EssentialityForm" ADD CONSTRAINT "EssentialityForm_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EssentialityForm" ADD CONSTRAINT "EssentialityForm_pmUserId_fkey" FOREIGN KEY ("pmUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EssentialityRating" ADD CONSTRAINT "EssentialityRating_essentialityFormId_fkey" FOREIGN KEY ("essentialityFormId") REFERENCES "EssentialityForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EssentialityRating" ADD CONSTRAINT "EssentialityRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingAssignment" ADD CONSTRAINT "StaffingAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingAssignment" ADD CONSTRAINT "StaffingAssignment_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCalendarLink" ADD CONSTRAINT "UserCalendarLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMeeting" ADD CONSTRAINT "ScheduledMeeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingException" ADD CONSTRAINT "MeetingException_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_parentPageId_fkey" FOREIGN KEY ("parentPageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorNote" ADD CONSTRAINT "MentorNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerUser" ADD CONSTRAINT "PartnerUser_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "PartnerOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPartner" ADD CONSTRAINT "ProjectPartner_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPartner" ADD CONSTRAINT "ProjectPartner_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "PartnerOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

