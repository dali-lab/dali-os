-- Per-recipient send tracking for notification email blasts. A row is
-- created after a successful send so the resend path can skip recipients
-- who already received the email — eliminates the duplicate-on-resend
-- failure mode after a partial blast. Keyed on applicationId (not userId)
-- because Application is unique per (userId, applicationCycleId), so the
-- unique constraint also enforces one email per applicant per cycle per
-- notification type even when the applicant has multiple DomainApplications.

CREATE TABLE "CycleNotificationSend" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationCycleId" TEXT NOT NULL,
    "notificationType" "NotificationType" NOT NULL,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "CycleNotificationSend_pkey" PRIMARY KEY ("id")
);

-- Prisma auto-generated name; matches the identifier the client expects
-- (Postgres truncates identifiers to 63 chars).
CREATE UNIQUE INDEX "CycleNotificationSend_applicationCycleId_notificationType_a_key"
  ON "CycleNotificationSend"("applicationCycleId", "notificationType", "applicationId");

CREATE INDEX "CycleNotificationSend_applicationCycleId_notificationType_idx"
  ON "CycleNotificationSend"("applicationCycleId", "notificationType");

ALTER TABLE "CycleNotificationSend"
  ADD CONSTRAINT "CycleNotificationSend_applicationCycleId_fkey"
  FOREIGN KEY ("applicationCycleId") REFERENCES "ApplicationCycle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CycleNotificationSend"
  ADD CONSTRAINT "CycleNotificationSend_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
