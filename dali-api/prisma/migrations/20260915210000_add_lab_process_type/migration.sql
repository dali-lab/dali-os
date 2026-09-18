-- Lab-wide, everyone-can-see folder bindings: the open counterpart of the Core
-- process type, for folders the whole lab files into. Backs the Lab drive's
-- "Meeting notes" folder, so a meeting note that belongs to no project lands
-- somewhere instead of loose at the Lab root.
--
-- Additive only: adding an enum value leaves every existing ProcessFolderBinding
-- row untouched. Nothing writes 'Lab' until application code does, so the value
-- is never used in the same transaction that creates it.
ALTER TYPE "ProcessType" ADD VALUE 'Lab';
