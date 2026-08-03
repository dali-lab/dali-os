-- E-sign audit trail on the partner contract (UETA/ESIGN defensibility):
-- signer IP + user agent, and a SHA-256 of the contract body as signed.
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSignerIp" TEXT;
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSignerUserAgent" TEXT;
ALTER TABLE "PartnerApplication" ADD COLUMN "contractSignedHash" TEXT;
