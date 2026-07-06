import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden, type AuthSuccess } from "~/lib/auth";
import { isCore } from "~/lib/roles";

/**
 * Offering-scoped manager check: Core (which already covers Admin) or an
 * InstructorAssignment for this offering (any term). PMs, mentors etc. get
 * nothing special — education management is instructor/Core only.
 */
export async function isOfferingManager(
  userId: string,
  offeringId: string,
): Promise<boolean> {
  if (await isCore(userId)) return true;
  const row = await prisma.instructorAssignment.findFirst({
    where: { userId, offeringId },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Offerings this user may manage. Core sees everything ("all"); instructors
 * see the offerings they hold an InstructorAssignment for.
 */
export async function manageableOfferingIds(
  userId: string,
): Promise<string[] | "all"> {
  if (await isCore(userId)) return "all";
  const rows = await prisma.instructorAssignment.findMany({
    where: { userId },
    select: { offeringId: true },
  });
  return rows.map((r) => r.offeringId);
}

export async function requireOfferingManager(
  request: Request,
  offeringId: string,
): Promise<{ ok: true; auth: AuthSuccess } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!(await isOfferingManager(auth.user.sub, offeringId))) {
    return { ok: false, response: forbidden(request) };
  }
  return { ok: true, auth };
}

export async function requireEducationCore(
  request: Request,
): Promise<{ ok: true; auth: AuthSuccess } | { ok: false; response: Response }> {
  const auth = await requireAuth(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  if (!(await isCore(auth.user.sub))) {
    return { ok: false, response: forbidden(request) };
  }
  return { ok: true, auth };
}

/**
 * Member-shell education routes send non-member Dartmouth students to the
 * portal mirror. Deliberately checks "dartmouth" — deriveAuthType never
 * produces "applicant", so the app-wide redirectApplicantToPortal helper is a
 * no-op and must not be relied on here.
 */
export function redirectDartmouthToPortal(auth: AuthSuccess): Response | null {
  if (auth.user.type === "dartmouth") return redirect("/portal/education");
  return null;
}
