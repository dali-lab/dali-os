import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { requireAuth } from "~/lib/auth";

export async function isInstructorOfOffering(
  userId: string,
  offeringId: string,
): Promise<boolean> {
  const row = await prisma.instructorAssignment.findFirst({
    where: { userId, offeringId },
    select: { id: true },
  });
  return row !== null;
}

export async function canManageOffering(
  userId: string,
  offeringId: string,
): Promise<boolean> {
  if (await isCore(userId)) return true;
  return isInstructorOfOffering(userId, offeringId);
}

export async function manageableOfferingIds(userId: string): Promise<string[] | "all"> {
  if (await isCore(userId)) return "all";
  const rows = await prisma.instructorAssignment.findMany({
    where: { userId },
    select: { offeringId: true },
  });
  return rows.map((r) => r.offeringId);
}

/**
 * Auth gate for member-side enrolled routes. Checks both enrollment (Approved
 * application) and manager preview access (instructor/Core). Returns the auth
 * context or throws a redirect.
 *
 * Every sub-route loader must call this independently because React Router
 * runs parent and child loaders in parallel — a redirect from the layout
 * loader does not prevent child loaders from executing.
 */
export async function requireEnrollment(request: Request, offeringId: string) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/login");
  if (auth.user.type === "applicant") throw redirect(`/portal/education/${offeringId}/enrolled`);

  const [application, isManager] = await Promise.all([
    prisma.educationApplication.findUnique({
      where: {
        applicantUserId_offeringId: { applicantUserId: auth.user.sub, offeringId },
      },
      select: { id: true, status: true },
    }),
    canManageOffering(auth.user.sub, offeringId),
  ]);

  if (!isManager && (!application || application.status !== "Approved")) {
    throw redirect(`/education/offerings/${offeringId}`);
  }

  return { user: auth.user, application, isManager };
}

/**
 * Auth gate for portal enrolled routes. Simpler than requireEnrollment: only
 * checks Approved application status (no manager preview path in portal).
 */
export async function requirePortalEnrollment(request: Request, offeringId: string) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirect("/login");

  const application = await prisma.educationApplication.findUnique({
    where: {
      applicantUserId_offeringId: { applicantUserId: auth.user.sub, offeringId },
    },
    select: { id: true, status: true },
  });

  if (!application || application.status !== "Approved") {
    throw redirect(`/portal/education/${offeringId}`);
  }

  return { user: auth.user, application };
}
