import { prisma } from "~/lib/db.server";
import { getUserRoles, isCore, isLabMember } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { canEditResourceHub, ledDomainIds } from "~/lib/resource-hub.server";
import { notify } from "~/lib/notify.server";
import { critThreadHref } from "~/lib/crit-comments";

export interface CritTarget {
  id: string;
  pageId: string;
  kind: string;
  title: string;
  authorId: string | null;
  canModerate: boolean;
}

/** The post, when this user may see its Crit Wall: flag on, member, and the hub is published or theirs to edit. */
export async function loadCritTarget(userId: string, submissionId: string, request?: Request): Promise<CritTarget | null> {
  const post = await prisma.critSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      kind: true,
      title: true,
      authorId: true,
      domainId: true,
      domain: { select: { resourceHubPage: { select: { id: true, domainId: true, createdById: true, publishedAt: true } } } },
    },
  });
  const hub = post?.domain.resourceHubPage;
  if (!post || !hub) return null;
  const roles = await getUserRoles(userId);
  const [enabled, labMember, core] = await Promise.all([
    isFeatureEnabled("resource-hub", userId, roles, request),
    isLabMember(userId, request),
    isCore(userId, request),
  ]);
  if (!enabled || !(labMember || core)) return null;
  if (!hub.publishedAt && !(await canEditResourceHub(userId, hub))) return null;
  const led = core ? [] : await ledDomainIds(userId);
  return { id: post.id, pageId: hub.id, kind: post.kind, title: post.title, authorId: post.authorId, canModerate: core || led.includes(post.domainId) };
}

export async function critPostExists(submissionId: string): Promise<{ kind: string } | null> {
  return prisma.critSubmission.findUnique({ where: { id: submissionId }, select: { kind: true } });
}

export async function critThreadLink(submissionId: string, threadId: string): Promise<string> {
  const post = await prisma.critSubmission.findUnique({
    where: { id: submissionId },
    select: { domain: { select: { resourceHubPage: { select: { id: true } } } } },
  });
  const pageId = post?.domain.resourceHubPage?.id;
  return pageId ? critThreadHref(pageId, { submissionId, threadId }) : "/";
}

/** Tells whoever shared the work about a new top-level comment. The recipient is the post's own author, so an anonymous post reveals nobody. */
export async function notifyCritComment(args: { submissionId: string; commenterId: string; commentId: string; body: string }): Promise<void> {
  const post = await prisma.critSubmission.findUnique({ where: { id: args.submissionId }, select: { authorId: true, title: true } });
  if (!post?.authorId || post.authorId === args.commenterId) return;
  const preview = args.body.length > 200 ? `${args.body.slice(0, 200)}…` : args.body;
  await notify({
    eventType: "crit.comment",
    createdByUserId: args.commenterId,
    message: {
      vars: { itemTitle: post.title, itemDetail: preview },
      link: await critThreadLink(args.submissionId, args.commentId),
    },
    recipients: [{ userId: post.authorId }],
  });
}

/** The user id whose comments this viewer must not see attributed: the author of an anonymous post, unless the viewer is that author or a moderator. */
export async function critHiddenAuthorId(viewerId: string, submissionId: string, request?: Request): Promise<string | null> {
  const post = await prisma.critSubmission.findUnique({ where: { id: submissionId }, select: { anonymous: true, authorId: true } });
  if (!post?.anonymous || !post.authorId || post.authorId === viewerId) return null;
  if ((await loadCritTarget(viewerId, submissionId, request))?.canModerate) return null;
  return post.authorId;
}

/** True when this user is the author of an anonymous post, so notifications they cause must not carry their id. */
export async function critActorIsAnonymous(submissionId: string, actorId: string): Promise<boolean> {
  const post = await prisma.critSubmission.findUnique({ where: { id: submissionId }, select: { anonymous: true, authorId: true } });
  return !!post?.anonymous && post.authorId === actorId;
}
