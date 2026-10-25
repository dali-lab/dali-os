-- Which Neon projects (databases) in the shared org belong to this DALI project.
ALTER TABLE "Project" ADD COLUMN "neonProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
