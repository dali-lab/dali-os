-- Partners board: a Backlog column ahead of New for applications parked
-- before triage. Additive only.
ALTER TYPE "PartnerStage" ADD VALUE 'Backlog' BEFORE 'New';
