import { redirect } from "react-router";
import { Presentation } from "lucide-react";
import type { Route } from "./+types/slides.$pageId";
import { requireLabViewer } from "~/lib/lab-viewer.server";
import { recordPageVisit } from "~/lib/user-pages.server";
import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";
import { slidesLiveEnabled } from "~/lib/slide-live.server";
import { transactDeck } from "~/collab/deck-live.server";
import { deckMissingSlots, toRenderDeck } from "~/collab/read-deck.server";
import { repairDeckSlots } from "~/components/slides/deck/deck-ops";
import { getCollabToken } from "~/lib/collab-token.server";
import { getPresenceUser } from "~/lib/presence-user.server";
import { parseSlideLink } from "~/lib/slide-comments";
import { isCore } from "~/lib/roles";
import { canManageSharing } from "~/lib/page-share-access.server";
import { deckAccessMode } from "~/components/slides/deck/model";
import { SlidesEditor } from "~/components/slides/collab/SlidesEditor";
import { DeckFollowLayer } from "~/components/slides/live/DeckFollowLayer";
import { PresentMenu } from "~/components/slides/live/PresentMenu";
import { ReadOnlyDeck } from "~/components/slides/collab/ReadOnlyDeck";
import { PageBarTitle } from "~/components/shell/page-bar-slot";
import { DeckDownloadItems } from "~/components/slides/pptx/DeckDownloadItems";
import { drivePageTrail, type DrivePageAncestry } from "~/components/drive/drive-page-trail";
import { loadDrivePageAncestry } from "~/drive/lib/drive-page-trail.server";
import { prisma } from "~/lib/db.server";

function DeckCrumbIcon({ iconEmoji }: { iconEmoji?: string | null }) {
  return (
    <span className="flex w-4 flex-shrink-0 items-center justify-center leading-none" aria-hidden>
      {iconEmoji ? <span className="text-sm">{iconEmoji}</span> : <Presentation className="h-3.5 w-3.5 text-muted-foreground" />}
    </span>
  );
}

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Slides · DALI OS" }];
};

export const handle = {
  fitViewport: true,
  breadcrumbTrail: (d: unknown) => {
    const loaded = d as Partial<DrivePageAncestry> | undefined;
    return drivePageTrail(loaded, <DeckCrumbIcon iconEmoji={loaded?.iconEmoji} />);
  },
};

async function requireMember(request: Request) {
  const { auth } = await requireLabViewer(request);
  return auth.user;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireMember(request);
  const userId = user.sub;
  const page = await prisma.page.findUnique({ where: { id: params.pageId }, select: { kind: true } });
  // A page of another kind reached via this URL opens on its own surface.
  if (page && page.kind !== "Slides") throw redirect(`/documents/${params.pageId}`);
  const access = await deckAccess(userId, params.pageId, request);
  if (!access.ok) throw new Response("Not found", { status: 404 });
  const full = await prisma.page.findUniqueOrThrow({
    where: { id: params.pageId },
    select: { title: true, iconEmoji: true, workspaceType: true, workspaceId: true, parentPageId: true, createdById: true },
  });
  const ancestry = await loadDrivePageAncestry(full, userId, request);
  recordPageVisit(userId, params.pageId, request);

  const read = await readDeckModel(params.pageId);
  const known = deckAccessMode(read.v) === "edit";
  if (access.canEdit && known && deckMissingSlots(read)) await transactDeck(params.pageId, userId, repairDeckSlots);
  const canManageAccess = await canManageSharing(
    { id: params.pageId, workspaceType: full.workspaceType, workspaceId: full.workspaceId, createdById: full.createdById },
    userId,
  );
  let collab: { token: string; userId: string; userName: string; photoUrl: string | null } | null = null;
  if (known) {
    const token = await getCollabToken(request);
    if (token) {
      const fallback = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
      const presence = await getPresenceUser(userId, fallback);
      collab = { token, userId, userName: presence?.name ?? fallback, photoUrl: presence?.photoUrl ?? null };
    }
  }
  const slidesLive = await slidesLiveEnabled(userId, request);
  return {
    ...ancestry,
    slidesLive,
    viewerId: userId,
    pageId: params.pageId,
    canEdit: access.canEdit,
    canComment: access.canComment,
    link: parseSlideLink(new URL(request.url).searchParams),
    canModerateComments: await isCore(userId, request),
    canManageAccess,
    workspaceType: full.workspaceType,
    unknownVersion: !known,
    collab,
    deck: collab && !slidesLive ? null : toRenderDeck(read),
  };
}

export default function SlideDeckPage({ loaderData }: Route.ComponentProps) {
  const { collab, deck, title, iconEmoji, pageId, canManageAccess, workspaceType, unknownVersion, slidesLive, viewerId, canEdit, canComment, canModerateComments, link } = loaderData;
  const page = collab ? (
    <SlidesEditor
      pageId={pageId}
      title={title}
      iconEmoji={iconEmoji ?? null}
      canEdit={canEdit}
      canComment={canComment}
      canModerateComments={canModerateComments}
      canManageAccess={canManageAccess}
      workspaceType={workspaceType}
      collab={collab}
      link={link}
      actionsSlot={
        slidesLive && canEdit ? ({ currentSlideId }) => <PresentMenu pageId={pageId} currentSlideId={currentSlideId} /> : undefined
      }
    />
  ) : (
    <>
      <PageBarTitle title={title} emoji={iconEmoji ?? null} />
      <DeckDownloadItems pageId={pageId} />
      <ReadOnlyDeck
        slides={deck?.slides ?? []}
        themeId={deck?.themeId ?? "dali-dark"}
        notice={unknownVersion ? "This deck was made with a newer version of Slides, so you can view it but not edit it." : undefined}
      />
    </>
  );
  if (!slidesLive || !deck) return page;
  return (
    <DeckFollowLayer pageId={pageId} viewerId={viewerId} canEdit={canEdit} token={collab?.token ?? null} deck={{ ...deck, notes: {} }}>
      {page}
    </DeckFollowLayer>
  );
}
