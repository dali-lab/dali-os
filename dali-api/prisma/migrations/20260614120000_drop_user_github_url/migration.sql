-- Drop the redundant User.githubUrl column. The display link is now derived
-- from githubUsername in the profile view, so the two-field split (one a bare
-- handle, the other a free-form URL) created drift without buying anything.
ALTER TABLE "User" DROP COLUMN "githubUrl";
