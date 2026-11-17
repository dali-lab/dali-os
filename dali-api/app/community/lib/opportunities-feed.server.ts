import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";
import { fullName } from "~/lib/display";
import { resolvePhotoUrl } from "~/lib/photo";
import { decodeCursor, keysetAfter, keysetPage } from "~/lib/pagination";
import { summarizeReactions } from "~/lib/reactions";
import { withEmojiImages } from "~/lib/reactions.server";
import { loadMyReferrals } from "~/partners/lib/referral-status.server";
import {
  OPPORTUNITY_IDS_MAX,
  chatAskMatch,
  type ChatMatchProfile,
  type ChatMatchReason,
} from "~/community/lib/opportunities";
import type { OpportunityViewer } from "~/community/lib/opportunities-viewer.server";

export const OPPORTUNITY_PAGE_SIZE = 30;
export const OPPORTUNITY_PINNED_MAX = 5;
const PINNED_SCAN_MAX = 200;

export type OpportunityShow = "all" | "jobs" | "chats";

export function parseShow(raw: string | null | undefined): OpportunityShow {
  return raw === "jobs" || raw === "chats" ? raw : "all";
}

const KIND_FOR_SHOW = { jobs: "Job", chats: "ChatAsk" } as const;

const AUTHOR_SELECT = { id: true, firstName: true, lastName: true, photoUrl: true, classYear: true } as const;

const POST_SELECT = {
  id: true,
  kind: true,
  body: true,
  topic: true,
  jobUrl: true,
  companyName: true,
  companyDomain: true,
  logoKey: true,
  blockColor: true,
  role: true,
  location: true,
  jobType: true,
  willRefer: true,
  imageKey: true,
  stillOpenAskedAt: true,
  createdAt: true,
  author: { select: AUTHOR_SELECT },
  responses: { select: { userId: true, kind: true } },
  reactions: {
    select: {
      emoji: true,
      userId: true,
      createdAt: true,
      user: { select: { firstName: true, lastName: true } },
    },
  },
  comments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, body: true, createdAt: true, author: { select: AUTHOR_SELECT } },
  },
} satisfies Prisma.OpportunityPostSelect;

type Row = Prisma.OpportunityPostGetPayload<{ select: typeof POST_SELECT }>;

const rawKeyUrl = (key: string) => `/api/upload/raw?key=${encodeURIComponent(key)}`;

export async function loadViewerMatchProfile(userId: string): Promise<ChatMatchProfile> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { askMeAbout: true, openToCoffeeChats: true, openToResumeReviews: true, openToPortfolioReviews: true },
  });
  return (
    me ?? { askMeAbout: [], openToCoffeeChats: false, openToResumeReviews: false, openToPortfolioReviews: false }
  );
}

async function shapePosts(rows: Row[], viewer: OpportunityViewer, profile: ChatMatchProfile) {
  const photoByUser = new Map<string, Promise<string | null>>();
  const person = async (author: NonNullable<Row["author"]>) => {
    if (!photoByUser.has(author.id)) photoByUser.set(author.id, resolvePhotoUrl(author.photoUrl));
    return { id: author.id, name: fullName(author), photoUrl: await photoByUser.get(author.id)! };
  };

  const posts = await Promise.all(
    rows.map(async (r) => {
      const own = r.author?.id === viewer.userId;
      const matchReason: ChatMatchReason | null =
        r.kind === "ChatAsk" && !own ? chatAskMatch(r.topic, profile) : null;
      return {
        id: r.id,
        kind: r.kind,
        body: r.body,
        topic: r.topic,
        createdAt: r.createdAt.toISOString(),
        author: r.author
          ? { ...(await person(r.author)), classYear: r.author.classYear }
          : { id: null, name: "DALI Lab", photoUrl: null, classYear: null },
        job:
          r.kind === "Job"
            ? {
                url: r.jobUrl,
                companyName: r.companyName,
                companyDomain: r.companyDomain,
                logoUrl: r.logoKey ? rawKeyUrl(r.logoKey) : null,
                blockColor: r.blockColor,
                role: r.role,
                location: r.location,
                jobType: r.jobType,
                willRefer: r.willRefer,
              }
            : null,
        imageUrl: r.imageKey ? rawKeyUrl(r.imageKey) : null,
        matchReason,
        responseCount: r.responses.length,
        viewerResponded: r.responses.some((x) => x.userId === viewer.userId),
        isOwn: own,
        askStillOpen: own && r.kind === "Job" && r.stillOpenAskedAt !== null,
        canDelete: viewer.core || own,
        canClose: own && r.kind !== "DaliUpdate",
        reactions: summarizeReactions(r.reactions, viewer.userId),
        comments: await Promise.all(
          r.comments.map(async (c) => ({
            id: c.id,
            body: c.body,
            createdAt: c.createdAt.toISOString(),
            author: await person(c.author!),
            canDelete: viewer.core || c.author!.id === viewer.userId,
          })),
        ),
      };
    }),
  );
  return withEmojiImages(posts);
}

export type OpportunityFeedPost = Awaited<ReturnType<typeof shapePosts>>[number];

function hasAnyMatchSetting(profile: ChatMatchProfile) {
  return (
    (profile.openToCoffeeChats && profile.askMeAbout.length > 0) ||
    profile.openToResumeReviews ||
    profile.openToPortfolioReviews
  );
}

async function findPinnedRows(viewer: OpportunityViewer, profile: ChatMatchProfile) {
  if (!hasAnyMatchSetting(profile)) return [];
  const candidates = await prisma.opportunityPost.findMany({
    where: { kind: "ChatAsk", closedAt: null, topic: { not: null }, NOT: { authorId: viewer.userId } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PINNED_SCAN_MAX,
    select: POST_SELECT,
  });
  return candidates.filter((r) => chatAskMatch(r.topic, profile) !== null).slice(0, OPPORTUNITY_PINNED_MAX);
}

export async function loadOpportunityPage(
  rawCursor: string | null,
  viewer: OpportunityViewer,
  opts: { show: OpportunityShow; profile: ChatMatchProfile },
) {
  const { show, profile } = opts;
  const firstPage = decodeCursor(rawCursor) === null;
  const pinnedRows = firstPage && show !== "jobs" ? await findPinnedRows(viewer, profile) : [];
  const pinnedIds = pinnedRows.map((r) => r.id);

  const rows = await prisma.opportunityPost.findMany({
    where: {
      closedAt: null,
      ...(show === "all" ? {} : { kind: KIND_FOR_SHOW[show] }),
      ...(pinnedIds.length ? { id: { notIn: pinnedIds } } : {}),
      ...keysetAfter("createdAt", decodeCursor(rawCursor)),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: OPPORTUNITY_PAGE_SIZE + 1,
    select: POST_SELECT,
  });
  const { items, nextCursor } = keysetPage(rows, OPPORTUNITY_PAGE_SIZE, (r) => ({
    at: r.createdAt.toISOString(),
    id: r.id,
  }));
  const [shaped, pinned] = await Promise.all([
    shapePosts(items, viewer, profile),
    shapePosts(pinnedRows, viewer, profile),
  ]);
  return { items: shaped, pinned, nextCursor };
}

export async function loadOpportunityPostsByIds(ids: string[], viewer: OpportunityViewer, profile: ChatMatchProfile) {
  const unique = [...new Set(ids)].slice(0, OPPORTUNITY_IDS_MAX);
  if (unique.length === 0) return [];
  const rows = await prisma.opportunityPost.findMany({
    where: { id: { in: unique }, closedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: POST_SELECT,
  });
  return shapePosts(rows, viewer, profile);
}

export async function loadOpportunityCounts() {
  const groups = await prisma.opportunityPost.groupBy({
    by: ["kind"],
    where: { closedAt: null },
    _count: { _all: true },
  });
  const count = (kind: string) => groups.find((g) => g.kind === kind)?._count._all ?? 0;
  return {
    all: groups.reduce((sum, g) => sum + g._count._all, 0),
    jobs: count("Job"),
    chats: count("ChatAsk"),
  };
}

export async function loadOpportunitiesPage(
  rawCursor: string | null,
  viewer: OpportunityViewer,
  show: OpportunityShow,
) {
  const profile = await loadViewerMatchProfile(viewer.userId);
  const [page, counts, referrals, me] = await Promise.all([
    loadOpportunityPage(rawCursor, viewer, { show, profile }),
    loadOpportunityCounts(),
    loadMyReferrals(viewer.userId),
    prisma.user.findUnique({ where: { id: viewer.userId }, select: AUTHOR_SELECT }),
  ]);
  return {
    ...page,
    me: { name: me ? fullName(me) : "", photoUrl: me ? await resolvePhotoUrl(me.photoUrl) : null },
    counts,
    show,
    referrals: referrals.map((r) => ({
      id: r.id,
      partnerName: r.partnerName,
      partnerOrgName: r.partnerOrgName,
      status: r.status,
      projectId: r.projectId,
    })),
  };
}
