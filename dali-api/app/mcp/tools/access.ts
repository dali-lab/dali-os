import { isCore, isProjectMember } from "~/lib/roles";

// Project-write gate for MCP tools. Mirrors the web's requireProjectEditAccess
// (app/lib/auth.ts): Core/Admin anywhere, or anyone staffed on the project
// (any term — past assignments keep workspace access, matching the app).
export async function canEditProject(userId: string, projectId: string): Promise<boolean> {
  const [core, member] = await Promise.all([
    isCore(userId),
    isProjectMember(userId, projectId),
  ]);
  return core || member;
}
