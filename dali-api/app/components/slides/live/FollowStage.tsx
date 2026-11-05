import { useCallback } from "react";
import { PresentStage } from "./PresentStage";
import { FollowChip } from "./FollowChip";
import type { PresentDeck } from "./deck-source";
import { positionFor, useDeckRender } from "./useDeckRender";
import { PollLayer } from "./PollLayer";
import { ReactionBar } from "./ReactionBar";
import { ReactionOverlay } from "./ReactionOverlay";
import { VotePanel } from "./VotePanel";
import { pollsOnSlide } from "./PresenterPolls";
import { usePolls } from "./usePolls";
import { useReactions, useSendReaction } from "./useReactions";

/** The presenter's slide and step, drawn full window with the chip that lets someone go their own way. */
export function FollowStage({
  pageId,
  deck,
  presenterName,
  slideId,
  build,
  reactionsOff,
  onBrowse,
}: {
  pageId: string;
  deck: PresentDeck;
  presenterName: string;
  slideId: string | null;
  build: number;
  reactionsOff: boolean;
  onBrowse: () => void;
}) {
  const { slideIds, stepsOf, renderSlide } = useDeckRender(deck);
  const pos = positionFor(slideIds, stepsOf, slideId, build) ?? { index: 0, step: 0 };
  const noop = useCallback(() => {}, []);
  const polls = usePolls(pageId);
  const reactions = useReactions(pageId, true);
  const react = useSendReaction(pageId);
  return (
    <PollLayer state={polls.state} onVote={polls.vote}>
      <PresentStage
        slideIds={slideIds}
        index={pos.index}
        step={pos.step}
        onIndexChange={noop}
        renderSlide={renderSlide}
        transitions={{ slides: deck.slides, themeId: deck.themeId }}
        navigable={false}
        onExit={onBrowse}
      >
        <ReactionOverlay items={reactions} />
        <VotePanel polls={pollsOnSlide(deck.slides.find((x) => x.id === slideIds[pos.index])?.elements)} />
        <div className="absolute inset-x-2 bottom-4 flex flex-col items-center gap-2">
          {!reactionsOff && <ReactionBar onReact={react} />}
          <FollowChip presenterName={presenterName} index={pos.index} total={slideIds.length} onBrowse={onBrowse} />
        </div>
      </PresentStage>
    </PollLayer>
  );
}
