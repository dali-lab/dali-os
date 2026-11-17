import { redirect } from "react-router";
import { prisma } from "~/lib/db.server";
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

export interface HubDomainOption {
  id: string;
  name: string;
  taken: boolean;
}

/** The domains this user may start a hub for: every domain for Core, the ones they lead this term otherwise. */
export async function hubDomainOptions(userId: string, core: boolean): Promise<HubDomainOption[]> {
  const led = core ? null : await ledDomainIds(userId);
  if (led && led.length === 0) return [];
  const rows = await prisma.domain.findMany({
    where: { active: true, isSystem: false, ...(led ? { id: { in: led } } : {}) },
    select: { id: true, displayName: true, resourceHubPage: { select: { id: true } } },
    orderBy: { displayName: "asc" },
  });
  return rows.map((d) => ({ id: d.id, name: d.displayName, taken: d.resourceHubPage !== null }));
}

/** Flag on and a lab member (or Core): who may open the Resource Hub at all. Null otherwise. */
export async function resourceHubViewer(userId: string, request?: Request): Promise<{ core: boolean } | null> {
  const roles = await getUserRoles(userId);
  const [enabled, labMember, core] = await Promise.all([
    isFeatureEnabled("resource-hub", userId, roles, request),
    isLabMember(userId, request),
    isCore(userId, request),
  ]);
  return enabled && (labMember || core) ? { core } : null;
}

export interface HubAccess {
  hub: {
    id: string;
    title: string;
    coverUrl: string | null;
    publishedAt: Date | null;
    domainId: string | null;
    createdById: string | null;
    domain: { displayName: string } | null;
  };
  viewerId: string;
  core: boolean;
  canEdit: boolean;
  canModerate: boolean;
}

/** One hub for a caller outside the web session (MCP): null unless the flag is on, they are a member, and the hub is published or theirs to edit. */
export async function loadHubAccess(
  userId: string,
  ref: { hubId?: string; domainId?: string },
  request?: Request,
): Promise<HubAccess | null> {
  const viewer = await resourceHubViewer(userId, request);
  if (!viewer) return null;
  const where = ref.hubId ? { id: ref.hubId } : ref.domainId ? { domainId: ref.domainId } : null;
  if (!where) return null;
  const hub = await prisma.resourceHubPage.findFirst({
    where,
    select: {
      id: true,
      title: true,
      coverUrl: true,
      publishedAt: true,
      domainId: true,
      createdById: true,
      domain: { select: { displayName: true } },
    },
  });
  if (!hub) return null;
  const canEdit = await canEditResourceHub(userId, hub);
  if (!hub.publishedAt && !canEdit) return null;
  const led = viewer.core ? [] : await ledDomainIds(userId);
  const canModerate = viewer.core || (hub.domainId !== null && led.includes(hub.domainId));
  return { hub, viewerId: userId, core: viewer.core, canEdit, canModerate };
}

// Behind the `resource-hub` flag, open to every lab member. 404 (not a
// redirect) when off so the feature's existence isn't leaked.
export async function requireResourceHubViewer(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;

  const viewer = await resourceHubViewer(auth.user.sub, request);
  if (!viewer) throw new Response("Not found", { status: 404 });
  const { core } = viewer;

  return {
    user: auth.user,
    core,
    userName:
      [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") || auth.user.email,
  };
}

/** The hub every tab shares; a draft is a 404 to anyone who can't edit it. */
export async function loadHubShell(request: Request, pageId: string) {
  const viewer = await requireResourceHubViewer(request);
  const page = await prisma.resourceHubPage.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      title: true,
      coverUrl: true,
      publishedAt: true,
      domainId: true,
      createdById: true,
      domain: { select: { displayName: true } },
    },
  });
  if (!page) throw new Response("Not found", { status: 404 });
  const canEdit = await canEditResourceHub(viewer.user.sub, page);
  if (!page.publishedAt && !canEdit) throw new Response("Not found", { status: 404 });
  return { viewer, page, canEdit };
}
