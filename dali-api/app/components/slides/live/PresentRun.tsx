import { useCallback, useEffect, useRef } from "react";
import { Link } from "react-router";
import { useDesktopVersion } from "~/lib/desktop";
import { Button } from "~/components/ui/Button";
import type { DeckPosition } from "~/components/slides/deck/builds";
import { PresentStage } from "./PresentStage";
import { PresenterView } from "./PresenterView";
import { FollowStage } from "./FollowStage";
import { deckUrl, presentUrl } from "./urls";
import type { PresentDeck } from "./deck-source";
import { usePresenterSession } from "./usePresenterSession";
import { useFollowDeck } from "./useFollowDeck";
import { positionFor, useDeckRender } from "./useDeckRender";

export interface DriverProps {
  pageId: string;
  title: string;
  viewerId: string;
  deck: PresentDeck;
  startSlideId: string | null;
  view: "present" | "presenter";
  onLeave: () => void;
}

/** Runs the presentation: starts it on open, posts every move, and ends it on Esc or End. */
export function PresentDriver({ pageId, title, viewerId, deck, startSlideId, view, onLeave }: DriverProps) {
  const { live, ready, start, go, end } = usePresenterSession(pageId);
  const { slideIds, stepsOf, renderSlide } = useDeckRender(deck);
  const desktop = useDesktopVersion() != null;
  const started = useRef(false);
  const wasActive = useRef(false);

  const first = positionFor(slideIds, stepsOf, startSlideId, 0) ?? { index: 0, step: 0 };
  const mineLive = live.active && live.presenter?.id === viewerId;
  const pos = (mineLive && positionFor(slideIds, stepsOf, live.slideId, live.build)) || first;

  useEffect(() => {
    if (started.current || !ready || slideIds.length === 0) return;
    started.current = true;
    if (!mineLive) void start(slideIds[first.index], 0);
  }, [ready, slideIds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (live.active) wasActive.current = true;
    else if (wasActive.current) onLeave();
  }, [live.active]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = useCallback(
    (to: DeckPosition) => {
      const id = slideIds[to.index];
      if (id) void go(id, to.step);
    },
    [slideIds, go],
  );
  const finish = useCallback(() => void end(), [end]);
  const ignore = useCallback(() => {}, []);

  if (view === "presenter") {
    return (
      <PresenterView
        title={title}
        slideIds={slideIds}
        notes={deck.notes}
        index={pos.index}
        step={pos.step}
        stepsOf={stepsOf}
        onIndexChange={ignore}
        onPositionChange={move}
        renderSlide={renderSlide}
        onEnd={finish}
        shareUrl={typeof window === "undefined" ? undefined : `${window.location.origin}${deckUrl(pageId)}`}
        startedAt={live.startedAt}
        actions={
          desktop ? (
            <Link to={presentUrl(pageId, slideIds[pos.index])} className="text-xs text-os-accent underline">
              Open slide show
            </Link>
          ) : undefined
        }
      />
    );
  }
  return (
    <PresentStage
      slideIds={slideIds}
      index={pos.index}
      step={pos.step}
      stepsOf={stepsOf}
      onIndexChange={ignore}
      onPositionChange={move}
      renderSlide={renderSlide}
      transitions={{ slides: deck.slides, themeId: deck.themeId }}
      onExit={finish}
    />
  );
}

/** For people who can't drive: the stage follows whoever is presenting. */
export function PresentFollower({ pageId, deck, onLeave }: { pageId: string; deck: PresentDeck; onLeave: () => void }) {
  const follow = useFollowDeck(pageId);
  if (!follow.active || !follow.presenter) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-os-grey" role="status">
        <p>{follow.ready ? "Nobody is presenting right now." : "Checking for a presentation..."}</p>
        <Link to={deckUrl(pageId)}>
          <Button variant="secondary" size="sm">
            Back to the deck
          </Button>
        </Link>
      </div>
    );
  }
  return <FollowStage deck={deck} presenterName={follow.presenter.name} slideId={follow.slideId} build={follow.build} onBrowse={onLeave} />;
}
