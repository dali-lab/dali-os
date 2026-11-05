import { useCallback } from "react";
import { PresentStage } from "./PresentStage";
import { FollowChip } from "./FollowChip";
import type { PresentDeck } from "./deck-source";
import { positionFor, useDeckRender } from "./useDeckRender";

/** The presenter's slide and step, drawn full window with the chip that lets someone go their own way. */
export function FollowStage({
  deck,
  presenterName,
  slideId,
  build,
  onBrowse,
}: {
  deck: PresentDeck;
  presenterName: string;
  slideId: string | null;
  build: number;
  onBrowse: () => void;
}) {
  const { slideIds, stepsOf, renderSlide } = useDeckRender(deck);
  const pos = positionFor(slideIds, stepsOf, slideId, build) ?? { index: 0, step: 0 };
  const noop = useCallback(() => {}, []);
  return (
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
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        <FollowChip presenterName={presenterName} index={pos.index} total={slideIds.length} onBrowse={onBrowse} />
      </div>
    </PresentStage>
  );
}
