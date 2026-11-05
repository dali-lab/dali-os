import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/Button";
import { DeckSource, type PresentDeck } from "./deck-source";
import { FollowStage } from "./FollowStage";
import { useFollowDeck } from "./useFollowDeck";

export interface DeckFollowLayerProps {
  pageId: string;
  viewerId: string;
  canEdit: boolean;
  token: string | null;
  deck: PresentDeck;
  children: ReactNode;
}

/**
 * Viewers follow a presentation as soon as one starts. Editors are asked first so
 * the deck they are working on isn't taken from them.
 */
export function DeckFollowLayer({ pageId, viewerId, canEdit, token, deck, children }: DeckFollowLayerProps) {
  const follow = useFollowDeck(pageId);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!follow.active) setAccepted(false);
  }, [follow.active]);

  const others = follow.active && follow.presenter != null && follow.presenter.id !== viewerId;
  const following = others && follow.following && (!canEdit || accepted);
  const presenterName = follow.presenter?.name ?? "";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {others && !following && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-os-container bg-os-card px-4 py-2 text-sm text-os-fg">
          <span className="h-2 w-2 rounded-full bg-os-green" aria-hidden />
          <span>{presenterName} is presenting</span>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              setAccepted(true);
              follow.follow();
            }}
          >
            Follow
          </Button>
        </div>
      )}
      {children}
      {following && (
        <div className="absolute inset-0 z-30 bg-os-bg">
          <DeckSource pageId={pageId} token={token} fallback={deck}>
            {(view) => (
              <FollowStage
                pageId={pageId}
                deck={view}
                presenterName={presenterName}
                slideId={follow.slideId}
                build={follow.build}
                reactionsOff={follow.reactionsOff}
                onBrowse={() => {
                  setAccepted(false);
                  follow.browseOnMyOwn();
                }}
              />
            )}
          </DeckSource>
        </div>
      )}
    </div>
  );
}
