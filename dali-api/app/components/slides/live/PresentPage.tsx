import { useNavigate } from "react-router";
import { DeckSource, type PresentDeck } from "./deck-source";
import { PresentDriver, PresentFollower } from "./PresentRun";
import { deckUrl } from "./urls";

export interface PresentPageData {
  pageId: string;
  title: string;
  viewerId: string;
  canDrive: boolean;
  token: string | null;
  deck: PresentDeck;
  startSlideId: string | null;
}

/** The whole window for presenting: the slide show or the presenter view for people who can drive, and the followed stage for everyone else. */
export function PresentPage({ data, view }: { data: PresentPageData; view: "present" | "presenter" }) {
  const { pageId, title, viewerId, canDrive, token, deck, startSlideId } = data;
  const navigate = useNavigate();
  const leave = () => navigate(deckUrl(pageId));
  return (
    <div className="fixed inset-0 z-50 bg-os-bg">
      <DeckSource pageId={pageId} token={token} fallback={deck}>
        {(live) =>
          canDrive ? (
            <PresentDriver pageId={pageId} title={title} viewerId={viewerId} deck={live} startSlideId={startSlideId} view={view} onLeave={leave} />
          ) : (
            <PresentFollower pageId={pageId} deck={live} onLeave={leave} />
          )
        }
      </DeckSource>
    </div>
  );
}
