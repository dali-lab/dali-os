-- Per-binding question→column mapping for a staffing slot's bound form:
-- which form question fills each structured role (project/domain/notes for
-- bids; per-term status for intent) plus the manager's renamed column label.
-- Shape is { version, entries: [{ questionKey, role, label, termId? }] },
-- validated in the app layer (slot-roles.ts).
--
-- Additive, nullable JSONB. Pre-existing bindings get NULL = "not mapped
-- yet"; the slot's submit path fails closed until a manager defines it. No
-- backfill, no table rewrite, no data loss.

-- AlterTable
ALTER TABLE "StaffingCycleFormBinding" ADD COLUMN "columnMapping" JSONB;
