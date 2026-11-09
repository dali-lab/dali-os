import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { currentTerm, getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

// Core, the page's creator, or a lead of its domain this term lays it out.
export async function canEditResourceHub(
  userId: string,
  page: { createdById: string | null; domainId: string | null },
): Promise<boolean> {
  if (page.createdById === userId || (await isCore(userId))) return true;
  if (!page.domainId) return false;
  const term = await currentTerm();
  if (!term) return false;
  const lead = await prisma.domainLeadAssignment.findFirst({
    where: { userId, domainId: page.domainId, termId: term.id },
    select: { id: true },
  });
  return lead !== null;
}

/** The domains this user leads this term (empty for anyone else). */
export async function ledDomainIds(userId: string): Promise<string[]> {
  const term = await currentTerm();
  if (!term) return [];
  const rows = await prisma.domainLeadAssignment.findMany({
    where: { userId, termId: term.id },
    select: { domainId: true },
  });
  return rows.map((r) => r.domainId);
}

// Behind the `resource-hub` flag, open to every lab member. 404 (not a
// redirect) when off so the feature's existence isn't leaked.
export async function requireResourceHubViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;

  const userId = auth.user.sub;
  const roles = await getUserRoles(userId);
  const [enabled, labMember, core] = await Promise.all([
    isFeatureEnabled("resource-hub", userId, roles, request),
    isLabMember(userId, request),
    isCore(userId, request),
  ]);
  if (!enabled || !(labMember || core)) throw new Response("Not found", { status: 404 });

  return {
    user: auth.user,
    core,
    userName:
      [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email,
  };
}
