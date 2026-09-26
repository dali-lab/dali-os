// Who can read which mailbox in the Email tab:
// - Personal: its owner.
// - Project: members staffed on the project this term — automatic.
// - Shared: people subscribed to a category (MailCategory) that holds it,
//   while they're in that category's audience. Each reads it with their own
//   sign-in (MailAccountConnection), never a teammate's.

import type { MailAccountKind } from "~/generated/prisma/enums";
import { prisma } from "~/lib/db";
import { resolveGroupMembers } from "~/lib/groups";
import { currentTerm } from "~/lib/roles";

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

export async function readableMailAccounts(userId: string, request: Request) {
  const [projectIds, sharedIds] = await Promise.all([
    currentProjectIds(userId, request),
    subscribedSharedAccountIds(userId),
  ]);
  const rows = await prisma.mailAccount.findMany({
    where: {
      OR: [
        { scopeKey: `user:${userId}` },
        { kind: "Project", projectId: { in: projectIds } },
        { kind: "Shared", id: { in: sharedIds } },
      ],
    },
    include: {
      project: { select: { name: true } },
      connections: { where: { userId }, select: { id: true, oauthTokens: true, syncError: true } },
    },
    orderBy: [{ kind: "asc" }, { address: "asc" }],
  });
  // A Shared inbox carries the viewer's own tokens, so everything downstream
  // (feed, send, unread) reads it as them.
  return rows.map(({ connections: [mine], ...a }) =>
    a.kind === "Shared"
      ? { ...a, oauthTokens: mine?.oauthTokens ?? null, syncError: mine?.syncError ?? null, connectionId: mine?.id ?? null }
      : { ...a, connectionId: null },
  );
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
  | { kind: "Personal" }
  | { kind: "Project"; projectId: string }
  | { kind: "Shared"; accountId: string };

export function parseConnectTarget(raw: string | null): ConnectTarget | null {
  if (raw === "personal") return { kind: "Personal" };
  const [kind, id] = (raw ?? "").split(":");
  if (kind === "project" && id) return { kind: "Project", projectId: id };
  if (kind === "shared" && id) return { kind: "Shared", accountId: id };
  return null;
}

export function serializeConnectTarget(t: ConnectTarget): string {
  if (t.kind === "Personal") return "personal";
  return t.kind === "Project" ? `project:${t.projectId}` : `shared:${t.accountId}`;
}

// The address a connect must sign in as (null = any Google account), or
// undefined when the user may not connect this target.
export async function expectedConnectAddress(
  userId: string,
  target: ConnectTarget,
  request: Request,
): Promise<string | null | undefined> {
  if (target.kind === "Personal") return null;
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
  // A Shared inbox: anyone subscribed to it signs in for themselves.
  const account = await findReadableAccount(userId, target.accountId, request);
  return account?.kind === "Shared" ? account.address : undefined;
}
