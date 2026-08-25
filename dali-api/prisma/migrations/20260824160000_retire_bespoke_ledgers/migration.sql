-- Retire the CycleNotificationSend and SignRequestNotification bespoke dedup
-- ledgers. Their per-recipient "already sent / already notified" role is now
-- carried by the outbox dedupKey (extension notices) and the notify() dedupKey
-- on the in-app Notification (sign requests).
--
-- The two backfills below run BEFORE the DROPs so a migrate can't re-blast:
-- they translate each existing ledger row into the new claim mechanism.

-- ── Backfill 1: CycleNotificationSend → outbox claims ────────────────────────
-- One "Sent" OutboundMessage per already-sent extension-notice recipient, keyed
-- exactly as blastExtensionNotice now keys its sends, so the manual resend
-- (which bypasses the cycle marker) no-ops for them. target is empty (historical
-- claim, never re-sent). gen_random_uuid() is built-in on Postgres 13+.
INSERT INTO "OutboundMessage" ("id", "channel", "dedupKey", "target", "status", "eventType", "createdAt", "sentAt")
SELECT gen_random_uuid()::text,
       'email',
       'hiring.extension:' || s."applicationCycleId" || ':' || s."applicationId",
       '',
       'Sent',
       'hiring.extension_notice',
       now(),
       now()
FROM "CycleNotificationSend" s
WHERE s."notificationType" = 'ApplicationExtensionNotice'
ON CONFLICT ("channel", "dedupKey") DO NOTHING;

-- ── Backfill 2: SignRequestNotification → Notification.dedupKey ──────────────
-- Key the matching in-app "document.sign_request" notification with the same
-- forever key notifySignRequest now uses, so a re-issue no-ops for signers
-- already asked. DISTINCT ON keeps the (recipientUserId, dedupKey) unique index
-- satisfied — at most one notification per (signer, binding) is keyed, and each
-- gets a key distinct within that recipient (bindingId is part of the key).
WITH latest_ledger AS (
  SELECT DISTINCT ON (s."signerUserId", s."bindingId")
         s."signerUserId", s."bindingId", s."versionId"
  FROM "SignRequestNotification" s
  ORDER BY s."signerUserId", s."bindingId", s."versionId" DESC
),
target AS (
  SELECT DISTINCT ON (n."recipientUserId", n."link")
         n."id" AS notif_id,
         'signing.request:' || l."bindingId" || ':' || l."versionId" || ':' || l."signerUserId" AS newkey
  FROM "Notification" n
  JOIN latest_ledger l
    ON n."recipientUserId" = l."signerUserId"
   AND n."link" = '/sign/' || l."bindingId"
  WHERE n."eventType" = 'document.sign_request'
    AND n."dedupKey" IS NULL
  ORDER BY n."recipientUserId", n."link", n."createdAt" DESC
)
UPDATE "Notification" n
SET "dedupKey" = t.newkey
FROM target t
WHERE n."id" = t.notif_id;

-- ── Drops ────────────────────────────────────────────────────────────────────
-- DropForeignKey
ALTER TABLE "CycleNotificationSend" DROP CONSTRAINT "CycleNotificationSend_applicationCycleId_fkey";

-- DropForeignKey
ALTER TABLE "CycleNotificationSend" DROP CONSTRAINT "CycleNotificationSend_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "SignRequestNotification" DROP CONSTRAINT "SignRequestNotification_bindingId_fkey";

-- DropTable
DROP TABLE "CycleNotificationSend";

-- DropTable
DROP TABLE "SignRequestNotification";
