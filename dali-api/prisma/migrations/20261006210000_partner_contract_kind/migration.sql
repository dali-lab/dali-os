-- Tag SigningDocuments used as partner-contract templates, so the partner
-- application's "send contract" picker can filter to just those. Audience /
-- cadence / gateScope still drive all enforcement — kind is a UI/API filter
-- only. Additive: new nullable column, defaults to NULL for every existing
-- document, no backfill.
CREATE TYPE "SigningDocumentKind" AS ENUM ('PartnerContract');

ALTER TABLE "SigningDocument" ADD COLUMN "kind" "SigningDocumentKind";
