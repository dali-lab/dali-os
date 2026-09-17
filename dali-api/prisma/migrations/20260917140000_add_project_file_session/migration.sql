-- Education timeline placement: attach an uploaded offering file to a specific
-- EducationSession so it renders under that session on the student course
-- timeline. Nullable = a whole-offering material. Loose FK (no DB constraint),
-- matching Page.sessionId / the ProjectFile.workspaceId convention.
ALTER TABLE "ProjectFile" ADD COLUMN "sessionId" TEXT;
