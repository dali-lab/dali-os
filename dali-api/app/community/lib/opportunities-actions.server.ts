import { prisma } from "~/lib/db.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { fullName, primaryEmail } from "~/lib/display";
import { escapeHtml } from "~/lib/email";
import { renderEmailDocument } from "~/email/lib/layout";
import { getFrontendUrl } from "~/lib/app-env";
import { isUniqueViolation } from "~/lib/prisma-errors";
import { notify } from "~/lib/notify.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { opportunityChatIntroKey } from "~/lib/outbound-keys.server";
import { extractHandlesFromText, notifyMentions, resolveHandles } from "~/lib/mentions.server";
import { toggleReaction } from "~/lib/reactions.server";
import {
  OPPORTUNITY_BODY_MAX,
  OPPORTUNITY_COMMENT_MAX,
  OPPORTUNITY_FIELD_MAX,
  OPPORTUNITY_NOTE_MAX,
  OPPORTUNITY_TOPIC_MAX,
  chatAskMatch,
  isBlockColor,
} from "~/community/lib/opportunities";
import { canPostJob, type OpportunityViewer } from "~/community/lib/opportunities-viewer.server";

export type OpportunityActionResult = { ok: true } | { ok: false; status: number };

const ok = { ok: true } as const;
const fail = (status: number): OpportunityActionResult => ({ ok: false, status });

const FEED_LINK = "/community/opportunities";
const MATCH_CANDIDATES_MAX = 2000;
const LOGO_KEY = /^uploads\/[A-Za-z0-9/_.-]{1,300}$/;
const DOMAIN = /^[a-z0-9.-]{1,200}$/;

function snippet(text: string, max = 200) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function httpUrl(raw: string): string | null {
  if (raw.length > 2000) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function notifyMatchingMembers(post: { id: string; topic: string; body: string }, asker: OpportunityViewer) {
  const [candidates, me] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { not: asker.userId },
        OR: [
          { openToCoffeeChats: true, askMeAbout: { isEmpty: false } },
          { openToResumeReviews: true },
          { openToPortfolioReviews: true },
        ],
      },
      take: MATCH_CANDIDATES_MAX,
      select: {
        id: true,
        askMeAbout: true,
        openToCoffeeChats: true,
        openToResumeReviews: true,
        openToPortfolioReviews: true,
      },
    }),
    prisma.user.findUnique({ where: { id: asker.userId }, select: { firstName: true, lastName: true } }),
  ]);
  const recipients = candidates.filter((c) => chatAskMatch(post.topic, c) !== null).map((c) => ({ userId: c.id }));
  if (recipients.length === 0) return;
  await notify({
    eventType: "opportunities.chat_ask_match",
    createdByUserId: asker.userId,
    message: {
      vars: {
        personName: me ? fullName(me) : "A member",
        itemDetail: `Wants to chat about ${post.topic}: ${snippet(post.body)}`,
      },
      link: FEED_LINK,
    },
    recipients,
  });
}

async function create(request: Request, viewer: OpportunityViewer, form: FormData): Promise<OpportunityActionResult> {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  if (checkRateLimit(request, { max: 10, windowMs: 60_000 }, `opportunities:${viewer.userId}`)) return fail(429);
  const kind = text("kind");
  const body = text("body");
  if (!body || body.length > OPPORTUNITY_BODY_MAX) return fail(400);

  if (kind === "ChatAsk") {
    const topic = text("topic");
    if (!topic || topic.length > OPPORTUNITY_TOPIC_MAX) return fail(400);
    const post = await prisma.opportunityPost.create({
      data: { kind: "ChatAsk", authorId: viewer.userId, body, topic },
      select: { id: true },
    });
    await notifyMatchingMembers({ id: post.id, topic, body }, viewer);
    return ok;
  }

  if (kind === "Job") {
    if (!canPostJob(viewer)) return fail(403);
    const companyName = text("companyName");
    const role = text("role");
    const location = text("location");
    const jobType = text("jobType");
    const rawUrl = text("jobUrl");
    const logoKey = text("logoKey");
    const companyDomain = text("companyDomain").toLowerCase();
    const blockColor = text("blockColor");
    if (!companyName || !role) return fail(400);
    if ([companyName, role, location, jobType].some((v) => v.length > OPPORTUNITY_FIELD_MAX)) return fail(400);
    const jobUrl = rawUrl ? httpUrl(rawUrl) : null;
    if (rawUrl && !jobUrl) return fail(400);
    if (logoKey && (!LOGO_KEY.test(logoKey) || logoKey.includes(".."))) return fail(400);
    await prisma.opportunityPost.create({
      data: {
        kind: "Job",
        authorId: viewer.userId,
        body,
        companyName,
        role,
        location: location || null,
        jobType: jobType || null,
        jobUrl,
        willRefer: text("willRefer") === "true",
        logoKey: logoKey || null,
        companyDomain: DOMAIN.test(companyDomain) ? companyDomain : null,
        blockColor: isBlockColor(blockColor) ? blockColor : null,
      },
    });
    return ok;
  }

  return fail(400);
}

async function postExists(id: string) {
  return (await prisma.opportunityPost.findUnique({ where: { id }, select: { id: true } })) !== null;
}

async function react(request: Request, viewer: OpportunityViewer, postId: string, emoji: string) {
  if (checkRateLimit(request, { max: 60, windowMs: 60_000 }, `opportunities-react:${viewer.userId}`)) return fail(429);
  if (!(await postExists(postId))) return fail(404);
  const mine = { postId, userId: viewer.userId, emoji };
  const result = await toggleReaction(
    {
      remove: async () => (await prisma.opportunityReaction.deleteMany({ where: mine })).count,
      usedEmoji: async () =>
        (
          await prisma.opportunityReaction.findMany({ where: { postId }, select: { emoji: true }, distinct: ["emoji"] })
        ).map((r) => r.emoji),
      add: () =>
        prisma.opportunityReaction.upsert({
          where: { postId_userId_emoji: mine },
          create: mine,
          update: {},
        }),
    },
    emoji,
  );
  return typeof result === "number" ? fail(result) : ok;
}

async function comment(request: Request, viewer: OpportunityViewer, postId: string, body: string) {
  if (checkRateLimit(request, { max: 30, windowMs: 60_000 }, `opportunities-comment:${viewer.userId}`)) return fail(429);
  if (!body || body.length > OPPORTUNITY_COMMENT_MAX) return fail(400);
  if (!(await postExists(postId))) return fail(404);
  await prisma.opportunityComment.create({ data: { postId, authorId: viewer.userId, body } });
  await notifyMentions({
    recipientUserIds: await resolveHandles(extractHandlesFromText(body)),
    actorId: viewer.userId,
    link: FEED_LINK,
    copyKey: "mention.comment",
    preview: body,
  });
  return ok;
}

async function createResponse(postId: string, userId: string, kind: "Interested" | "ChatOffer", note: string | null) {
  try {
    return await prisma.opportunityResponse.create({
      data: { postId, userId, kind, note },
      select: { id: true },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

async function interested(viewer: OpportunityViewer, postId: string, rawNote: string): Promise<OpportunityActionResult> {
  const note = rawNote.trim();
  if (note.length > OPPORTUNITY_NOTE_MAX) return fail(400);
  const post = await prisma.opportunityPost.findUnique({
    where: { id: postId },
    select: { kind: true, authorId: true, closedAt: true, role: true, companyName: true },
  });
  if (!post || post.closedAt || post.kind !== "Job" || !post.authorId) return fail(404);
  if (post.authorId === viewer.userId) return fail(403);
  const created = await createResponse(postId, viewer.userId, "Interested", note || null);
  if (!created) return ok;
  const me = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { firstName: true, lastName: true } });
  const job = [post.role, post.companyName].filter(Boolean).join(" at ");
  await notify({
    eventType: "opportunities.interest",
    createdByUserId: viewer.userId,
    message: {
      vars: {
        personName: me ? fullName(me) : "A member",
        itemDetail: note ? `Interested in ${job}. Their note: ${note}` : `Interested in ${job}.`,
      },
      link: `/members/${viewer.userId}`,
    },
    recipients: [{ userId: post.authorId }],
  });
  return ok;
}

function introEmail(args: { asker: string; offerer: string; topic: string }) {
  const intro = `${args.offerer} offered to chat with ${args.asker} about ${args.topic}. You are both on this email, so reply here to find a time.`;
  return {
    subject: `${args.offerer} and ${args.asker}: a coffee chat about ${args.topic}`,
    bodyText: intro,
    bodyHtml: renderEmailDocument({
      bodyHtml: `<p>${escapeHtml(intro)}</p>`,
      preheader: escapeHtml(`Reply to this email to find a time.`),
      footer: "transactional",
      baseUrl: getFrontendUrl(),
    }),
  };
}

async function offerChat(viewer: OpportunityViewer, postId: string): Promise<OpportunityActionResult> {
  const post = await prisma.opportunityPost.findUnique({
    where: { id: postId },
    select: { kind: true, authorId: true, closedAt: true, topic: true },
  });
  if (!post || post.closedAt || post.kind !== "ChatAsk" || !post.authorId) return fail(404);
  if (post.authorId === viewer.userId) return fail(403);
  const created = await createResponse(postId, viewer.userId, "ChatOffer", null);
  if (!created) return ok;
  const select = { firstName: true, lastName: true, daliEmail: true, dartmouthEmail: true, personalEmail: true } as const;
  const [offerer, asker] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewer.userId }, select }),
    prisma.user.findUnique({ where: { id: post.authorId }, select }),
  ]);
  const topic = post.topic ?? "a coffee chat";
  const offererName = offerer ? fullName(offerer) : "A member";
  await notify({
    eventType: "opportunities.chat_offered",
    createdByUserId: viewer.userId,
    message: {
      vars: {
        personName: offererName,
        itemDetail: `${offererName} offered to chat about ${topic}. We sent you both an email, so you can reply to it to find a time.`,
      },
      link: FEED_LINK,
    },
    recipients: [{ userId: post.authorId }],
  });
  const offererEmail = offerer ? primaryEmail(offerer) : null;
  const askerEmail = asker ? primaryEmail(asker) : null;
  if (offerer && asker && offererEmail && askerEmail) {
    const mail = introEmail({ asker: fullName(asker), offerer: offererName, topic });
    const queued = await enqueueOutbound({
      channel: "email",
      purpose: "General",
      dedupKey: opportunityChatIntroKey(created.id),
      target: `${askerEmail}, ${offererEmail}`,
      eventType: "opportunities.chat_offered",
      createdByUserId: viewer.userId,
      ...mail,
    });
    if (!queued.deduped) await drainNow([queued.id]);
  }
  return ok;
}

export async function runOpportunityAction(
  request: Request,
  viewer: OpportunityViewer,
  form: FormData,
): Promise<OpportunityActionResult> {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const postId = text("postId");
  const own = viewer.core ? {} : { authorId: viewer.userId };

  switch (form.get("intent")) {
    case "create":
      return create(request, viewer, form);
    case "react":
      return react(request, viewer, postId, text("emoji"));
    case "comment":
      return comment(request, viewer, postId, text("body"));
    case "delete":
      await prisma.opportunityPost.deleteMany({ where: { id: postId, ...own } });
      return ok;
    case "delete-comment":
      await prisma.opportunityComment.deleteMany({ where: { id: text("commentId"), ...own } });
      return ok;
    case "close":
      await prisma.opportunityPost.updateMany({
        where: { id: postId, authorId: viewer.userId, closedAt: null, kind: { in: ["Job", "ChatAsk"] } },
        data: { closedAt: new Date() },
      });
      return ok;
    case "keep-open":
      await prisma.opportunityPost.updateMany({
        where: { id: postId, authorId: viewer.userId, kind: "Job", stillOpenAskedAt: { not: null } },
        data: { stillOpenAskedAt: null, confirmedOpenAt: new Date() } as { stillOpenAskedAt: null },
      });
      return ok;
    case "interested":
      return interested(viewer, postId, String(form.get("note") ?? ""));
    case "offer-chat":
      return offerChat(viewer, postId);
    default:
      return fail(400);
  }
}
