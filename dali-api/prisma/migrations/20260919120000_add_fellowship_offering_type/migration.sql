-- Fellowship: a multi-session, reviewed education offering that spans several
-- terms. Additive: existing offerings keep their type, and nothing writes
-- 'Fellowship' in this same transaction.
ALTER TYPE "OfferingType" ADD VALUE 'Fellowship';
