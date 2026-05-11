-- Add the notification slot for the deadline-extension nudge that goes out to
-- draft applicants once the original close passes (and the cycle is still
-- open via an extension).
ALTER TYPE "NotificationType" ADD VALUE 'ApplicationExtensionNotice';

-- Idempotency marker for the extension-notice blast. Set when the notice is
-- sent (lazy trigger or manual resend); cleared when the extension is
-- removed so re-extending later can re-trigger the notice.
ALTER TABLE "ApplicationCycle" ADD COLUMN "extensionNoticeSentAt" TIMESTAMP(3);
