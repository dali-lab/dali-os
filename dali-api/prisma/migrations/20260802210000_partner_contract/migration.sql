-- Partner contract step (after the SOW is iterated): per-deal values that feed
-- the contract's merge variables + lifecycle mirror columns. The contract
-- itself runs on the shared signing engine (see 20260803130000).
ALTER TABLE "PartnerApplication" ADD COLUMN "contractFee" TEXT;
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSentAt" TIMESTAMP(3);
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSignedAt" TIMESTAMP(3);
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSignerName" TEXT;
