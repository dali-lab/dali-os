import { redirect } from "react-router";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { deckAccess, migrateDeckOnOpen } from "~/lib/slide-decks.server";
import { slidesLiveEnabled } from "~/lib/slide-live.server";
import { readLiveDeck } from "~/collab/deck-live.server";
import { notesBySlide, toRenderDeck } from "~/collab/read-deck.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { deckUrl } from "~/components/slides/live/urls";

async function requireMember(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;
  return auth.user;
}

/**
 * What the present and presenter routes load. Both are behind slides-live, and a deck that
 * hasn't moved to live editing opens on its ordinary page. Only people who can edit get notes.
 * Everyone connects to the room for the live deck, with a copy read here to draw until it's ready.
 */
export async function loadPresentPage(request: Request, pageId: string, opts: { driverOnly: boolean }) {
  const user = await requireMember(request);
  if (!(await slidesLiveEnabled(user.sub, request))) throw new Response("Not found", { status: 404 });
  const access = await deckAccess(user.sub, pageId, request);
  if (!access.ok) throw new Response("Not found", { status: 404 });
  if (opts.driverOnly && !access.canEdit) throw redirect(deckUrl(pageId));
  if ((await migrateDeckOnOpen(user.sub, pageId, request)) === "json") throw redirect(deckUrl(pageId));

  const { read } = await readLiveDeck(pageId);
  const canDrive = access.canEdit;
  const render = toRenderDeck(read);
  return {
    pageId,
    title: access.page.title,
    viewerId: user.sub,
    canDrive,
    token: await getCollabToken(request),
    deck: { ...render, notes: canDrive ? notesBySlide(read) : {} },
    startSlideId: new URL(request.url).searchParams.get("slide"),
  };
}
