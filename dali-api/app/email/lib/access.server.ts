// Who can read which mailbox in the Email tab:
// - Project: members staffed on the project this term. Every current project
//   with a project email gets its inbox automatically.
// - Shared: people subscribed to a category (MailCategory) that holds it,
//   while they're in that category's audience.
// - Personal: the member's own DALI address, behind the email-personal flag
//   and a recorded agreement to the risk notice. Only they can read it.
// Either way each person reads with their own sign-in (MailAccountConnection),
// never a teammate's, and may archive an inbox to hide it from their own list.

import type { MailAccountKind } from "~/generated/prisma/enums";
import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { currentTerm, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { PERSONAL_MAIL_NOTICE_VERSION } from "~/email/lib/personal-notice";

export async function currentProjectIds(userId: string, request: Request): Promise<string[]> {
  const term = await currentTerm(request);
  if (!term) return [];
  const rows = await prisma.projectAssignment.findMany({
    where: { userId, termId: term.id },
    select: { projectId: true },
    distinct: ["projectId"],
  });
  return rows.map((r) => r.projectId);
}

type Audience = { audienceUserIds: string[]; audienceGroupIds: string[] };

// Resolves each group at most once per call, however many categories share it.
function audienceChecker(userId: string) {
  const groups = new Map<string, Promise<string[]>>();
  return async (category: Audience): Promise<boolean> => {
    if (category.audienceUserIds.includes(userId)) return true;
    for (const groupId of category.audienceGroupIds) {
      if (!groups.has(groupId)) groups.set(groupId, resolveGroupMembers(groupId));
      if ((await groups.get(groupId)!).includes(userId)) return true;
    }
    return false;
  };
}

/** Categories this user is in the audience of, with their inboxes and whether they've subscribed. */
export async function categoriesForUser(userId: string) {
  const categories = await prisma.mailCategory.findMany({
    include: {
      accounts: { include: { account: { select: { id: true, address: true, displayName: true } } } },
      subscriptions: { where: { userId }, select: { userId: true } },
    },
    orderBy: { name: "asc" },
  });
  const inAudience = audienceChecker(userId);
  const visible: typeof categories = [];
  for (const c of categories) if (await inAudience(c)) visible.push(c);
  return visible;
}

async function subscribedSharedAccountIds(userId: string): Promise<string[]> {
  const subscriptions = await prisma.mailSubscription.findMany({
    where: { userId },
    select: {
      category: {
        select: { audienceUserIds: true, audienceGroupIds: true, accounts: { select: { accountId: true } } },
      },
    },
  });
  const inAudience = audienceChecker(userId);
  const ids = new Set<string>();
  for (const { category } of subscriptions) {
    if (await inAudience(category)) category.accounts.forEach((a) => ids.add(a.accountId));
  }
  return [...ids];
}

// Gives each of these projects its inbox row, so staffed members see it
// before anyone has signed in.
async function ensureProjectInboxes(projectIds: string[]) {
  if (projectIds.length === 0) return;
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds }, calendarEmail: { not: null } },
    select: { id: true, calendarEmail: true },
  });
  await prisma.mailAccount.createMany({
    data: projects.map((p) => ({
      kind: "Project" as const,
      address: p.calendarEmail!.toLowerCase(),
      scopeKey: `project:${p.id}`,
      projectId: p.id,
    })),
    skipDuplicates: true,
  });
}

// The member's own DALI address, or null when the flag is off for them or
// they have no DALI address on file.
async function personalInboxAddress(userId: string, request: Request): Promise<string | null> {
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("email-personal", userId, roles, request))) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { daliEmail: true } });
  return user?.daliEmail?.toLowerCase() ?? null;
}

/** Whether this member has agreed to the current risk notice for their personal inbox. */
export async function hasPersonalMailConsent(userId: string): Promise<boolean> {
  const row = await prisma.auditLog.findFirst({
    where: { userId, action: "email.personal_consent", targetId: PERSONAL_MAIL_NOTICE_VERSION },
    select: { id: true },
  });
  return row !== null;
}

export async function readableMailAccounts(userId: string, request: Request) {
  const [projectIds, sharedIds, personalAddress] = await Promise.all([
    currentProjectIds(userId, request),
    subscribedSharedAccountIds(userId),
    personalInboxAddress(userId, request),
  ]);
  await ensureProjectInboxes(projectIds);
  if (personalAddress) {
    await prisma.mailAccount.createMany({
      data: [{ kind: "Personal", address: personalAddress, scopeKey: `user:${userId}`, userId }],
      skipDuplicates: true,
    });
  }
  const rows = await prisma.mailAccount.findMany({
    where: {
      OR: [
        { kind: "Project", projectId: { in: projectIds } },
        { kind: "Shared", id: { in: sharedIds } },
        ...(personalAddress ? [{ kind: "Personal" as const, userId, address: personalAddress }] : []),
      ],
    },
    include: {
      project: { select: { name: true } },
      connections: { where: { userId }, select: { id: true, oauthTokens: true, syncError: true } },
      archives: { where: { userId }, select: { userId: true } },
    },
    orderBy: [{ kind: "asc" }, { address: "asc" }],
  });
  // Every inbox carries the viewer's own tokens, so everything downstream
  // (feed, send, unread) reads it as them.
  return rows.map(({ connections: [mine], archives, ...a }) => ({
    ...a,
    oauthTokens: mine?.oauthTokens ?? null,
    syncError: mine?.syncError ?? null,
    connectionId: mine?.id ?? null,
    archived: archives.length > 0,
  }));
}

export type ReadableMailAccount = Awaited<ReturnType<typeof readableMailAccounts>>[number];

export async function findReadableAccount(userId: string, accountId: string, request: Request) {
  const accounts = await readableMailAccounts(userId, request);
  return accounts.find((a) => a.id === accountId) ?? null;
}

export function mailAccountLabel(a: {
  kind: MailAccountKind;
  address: string;
  displayName: string | null;
  project?: { name: string } | null;
}): string {
  if (a.displayName) return a.displayName;
  if (a.kind === "Project" && a.project) return a.project.name;
  return a.address;
}

// Connect targets, as carried through the OAuth round trip.
export type ConnectTarget =
  | { kind: "Project"; projectId: string }
  | { kind: "Shared"; accountId: string }
  | { kind: "Personal" };

export function parseConnectTarget(raw: string | null): ConnectTarget | null {
  const [kind, id] = (raw ?? "").split(":");
  if (kind === "project" && id) return { kind: "Project", projectId: id };
  if (kind === "shared" && id) return { kind: "Shared", accountId: id };
  if (raw === "personal") return { kind: "Personal" };
  return null;
}

export function serializeConnectTarget(t: ConnectTarget): string {
  if (t.kind === "Personal") return "personal";
  return t.kind === "Project" ? `project:${t.projectId}` : `shared:${t.accountId}`;
}

// The address a connect must sign in as, or undefined when the user may not
// connect this target.
export async function expectedConnectAddress(
  userId: string,
  target: ConnectTarget,
  request: Request,
): Promise<string | undefined> {
  if (target.kind === "Project") {
    const [projectIds, project] = await Promise.all([
      currentProjectIds(userId, request),
      prisma.project.findUnique({
        where: { id: target.projectId },
        select: { calendarEmail: true },
      }),
    ]);
    if (!projectIds.includes(target.projectId) || !project?.calendarEmail) return undefined;
    return project.calendarEmail;
  }
  if (target.kind === "Personal") {
    // Never without the opt-in on record, however the request got here.
    const [address, consented] = await Promise.all([
      personalInboxAddress(userId, request),
      hasPersonalMailConsent(userId),
    ]);
    return address && consented ? address : undefined;
  }
  // A Shared inbox: anyone subscribed to it signs in.
  const account = await findReadableAccount(userId, target.accountId, request);
  return account?.kind === "Shared" ? account.address : undefined;
}
