import { useEffect, useMemo, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { SlideRender } from "~/components/slides/deck/SlideRender";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { SlideTransitionStage } from "~/components/slides/live/SlideTransitionStage";

const BLANK_ID = "preview-blank";
const WIDTH = 640;

export function TransitionPreview({ previous, slide, themeId, onClose }: { previous: RenderSlide | null; slide: RenderSlide; themeId: string; onClose: () => void }) {
  const from = useMemo<RenderSlide>(() => previous ?? { id: BLANK_ID, pos: 0, layoutId: "blank", elements: [] }, [previous]);
  const slides = useMemo(() => [from, slide], [from, slide]);
  const [shown, setShown] = useState(from.id);
  const [run, setRun] = useState(0);
  useEffect(() => {
    setShown(from.id);
    const t = setTimeout(() => setShown(slide.id), 400);
    return () => clearTimeout(t);
  }, [run, from.id, slide.id]);
  return (
    <Modal open onClose={onClose} labelledBy="slide-transition-title" containerClassName="w-full max-w-3xl rounded-os-card bg-os-card p-5 shadow-xl">
      <ModalHeader titleId="slide-transition-title" title="Transition preview" onClose={onClose} className="mb-3" />
      <div className="mx-auto overflow-hidden rounded-os-item" style={{ width: WIDTH, aspectRatio: "16 / 9" }}>
        <SlideTransitionStage
          slides={slides}
          themeId={themeId}
          slideId={shown}
          width={WIDTH}
          renderSlide={(id) => <SlideRender slide={slides.find((s) => s.id === id) ?? slide} theme={themeId} />}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setRun((n) => n + 1)}>
          Play again
        </Button>
      </div>
    </Modal>
  );
}
