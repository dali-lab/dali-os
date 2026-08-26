-- Per-member secret for the signed barcode carried in a member's Apple/Google
-- Wallet membership pass. Additive + nullable: no backfill, safe on a populated
-- table. See app/lib/wallet-token.ts.
ALTER TABLE "User" ADD COLUMN "walletPassSecret" TEXT;
