import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore, isInstructorFor } from "~/lib/roles";

// Common gate for Education routes. Returns either an auth'd userId with the
// access boolean, or a Response to throw from the loader/action.

export type EducationGate =
  | { ok: true; userId: string; isInstructor: boolean; isCore: boolean }
  | { ok: false; response: Response };

function forbidden(): Response {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export async function requireEducationManager(
  request: Request,
  offeringId: string | null,
): Promise<EducationGate> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };

  const userId = auth.user.sub;
  const coreFlag = await isCore(userId);
  let instructorFlag = false;
  if (offeringId) instructorFlag = await isInstructorFor(userId, offeringId);

  if (!coreFlag && !instructorFlag) return { ok: false, response: forbidden() };
  return { ok: true, userId, isInstructor: instructorFlag, isCore: coreFlag };
}

/** Lightweight auth-only gate (used for catalog + portal endpoints). */
export async function requireAnyAuthed(
  request: Request,
): Promise<
  | { ok: true; userId: string; email: string; firstName: string }
  | { ok: false; response: Response }
> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  return {
    ok: true,
    userId: auth.user.sub,
    email: auth.user.email,
    firstName: auth.user.firstName ?? "",
  };
}

export async function isApplicantOf(
  userId: string,
  applicationId: string,
): Promise<boolean> {
  const row = await prisma.educationApplication.findUnique({
    where: { id: applicationId },
    select: { applicantUserId: true },
  });
  return row?.applicantUserId === userId;
}
