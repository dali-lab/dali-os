import { useState } from "react";
import { Eye, Maximize2, Plus, Presentation, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import type { JourneyModule, Slide } from "~/journeys/lib/types";
import { createSlide } from "~/journeys/lib/journey-edit";
import { moduleTitle } from "~/journeys/lib/journey";
import { SlideCanvas } from "~/components/slides/SlideCanvas";
import { SlideViewer } from "~/components/slides/SlideViewer";
import { FullscreenEditor } from "./FullscreenEditor";
import { SlideEditorWorkspace } from "~/components/slides/editor/SlideEditorWorkspace";

const PREVIEW_COUNT = 6;

export function SlidesTab({
  module: mod,
  onChange,
}: {
  module: JourneyModule;
  onChange: (fn: (m: JourneyModule) => JourneyModule) => void;
}) {
  const dialog = useDialog();
  // undefined = closed; null = open with nothing selected.
  const [openAt, setOpenAt] = useState<string | null | undefined>(undefined);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const slides = mod.slides ?? [];
  const name = moduleTitle(mod);

  const setSlides = (fn: (ss: Slide[]) => Slide[]) =>
    onChange((m) => {
      const next = fn(m.slides ?? []);
      return { ...m, slides: next.length ? next : undefined };
    });

  const removeAll = async () => {
    const ok = await dialog.confirm({
      title: "Remove all slides?",
      description: "Learners will no longer see this deck.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (ok) onChange((m) => ({ ...m, slides: undefined }));
  };

  const editor = (
    <FullscreenEditor
      open={openAt !== undefined}
      title={`${name} · Slides`}
      subtitle="Changes save to your draft as you type"
      onClose={() => setOpenAt(undefined)}
      actions={
        <button type="button" onClick={() => setPreviewIndex(0)} disabled={slides.length === 0} className={buttonClasses("primary", "sm")}>
          <Eye className="h-3.5 w-3.5" aria-hidden />
          Preview
        </button>
      }
    >
      <SlideEditorWorkspace slides={slides} initialSlideId={openAt ?? null} onChangeSlides={setSlides} />
    </FullscreenEditor>
  );

  const preview = (
    <FullscreenEditor
      open={previewIndex !== null}
      title={`Previewing ${name} slides`}
      subtitle="This is what learners see."
      doneLabel="Close"
      onClose={() => setPreviewIndex(null)}
    >
      <SlideViewer
        slides={slides}
        index={Math.min(previewIndex ?? 0, Math.max(slides.length - 1, 0))}
        onIndexChange={setPreviewIndex}
        finalAction={{ label: "Close preview", onClick: () => setPreviewIndex(null) }}
      />
    </FullscreenEditor>
  );

  if (slides.length === 0) {
    return (
      <div className="py-8 text-center">
        <Presentation className="mx-auto h-8 w-8 text-os-muted" aria-hidden />
        <h4 className="mt-3 font-medium">No slides in this module</h4>
        <p className="mx-auto mt-1 max-w-xs text-sm text-os-grey">
          Add a short deck learners can click through or present. It sits next to the lesson pages.
        </p>
        <button
          type="button"
          onClick={() => {
            const first = createSlide("title", mod.title);
            setSlides(() => [first, createSlide("content")]);
            setOpenAt(first.id);
          }}
          className={buttonClasses("primary", "md", "mt-5")}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add slides
        </button>
        {editor}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-2">
        <button type="button" onClick={() => setOpenAt(slides[0]?.id ?? null)} className={buttonClasses("primary", "md", "w-full")}>
          <Maximize2 className="h-4 w-4" aria-hidden />
          Open slide editor
        </button>
        <button type="button" onClick={() => setPreviewIndex(0)} className={buttonClasses("secondary", "md", "w-full")}>
          <Eye className="h-4 w-4" aria-hidden />
          Preview as a learner
        </button>
      </div>

      <section>
        <h4 className="text-xs font-medium text-os-grey">
          {slides.length} {slides.length === 1 ? "slide" : "slides"}
        </h4>
        <ol className="mt-2 grid grid-cols-2 gap-3">
          {slides.slice(0, PREVIEW_COUNT).map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setOpenAt(s.id)}
                aria-label={`Edit slide ${i + 1}${s.title.trim() ? `: ${s.title}` : ""}`}
                className="w-full overflow-hidden rounded-lg ring-1 ring-os-container transition-shadow hover:ring-2 hover:ring-os-accent"
              >
                <SlideCanvas slide={s} className="pointer-events-none" />
              </button>
            </li>
          ))}
        </ol>
        {slides.length > PREVIEW_COUNT && <p className="mt-2 text-xs text-os-muted">+{slides.length - PREVIEW_COUNT} more</p>}
      </section>

      <section className="border-t border-os-container pt-5">
        <button type="button" onClick={() => void removeAll()} className={buttonClasses("ghost", "sm", "hover:text-destructive")}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Remove slides
        </button>
      </section>

      {editor}
      {preview}
    </div>
  );
}
