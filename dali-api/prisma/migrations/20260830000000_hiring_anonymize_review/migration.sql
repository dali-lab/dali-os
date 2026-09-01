-- Blind review: when true (Standard cycles), applicant identity is hidden from
-- reviewers on the review + Initial-delibs surfaces until a decision is Released
-- for them (they move into interviews). Additive with a default — safe on
-- populated tables; existing cycles backfill to true (blind by default, opt-out
-- per cycle in setup). See app/hiring/lib/anonymization.server.ts.

-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN     "anonymizeReview" BOOLEAN NOT NULL DEFAULT true;
