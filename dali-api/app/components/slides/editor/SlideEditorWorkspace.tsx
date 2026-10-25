import { useState } from "react";
import { Plus, Presentation } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Segmented } from "~/components/ui/Segmented";
import { useDialog } from "~/components/ui/dialog";
import type { Slide, SlideLayout } from "~/components/slides/types";
import { changeSlideLayout, createSlide, duplicateSlide, moveItem } from "~/components/slides/slide-edit";
import { SlideCanvas } from "~/components/slides/SlideCanvas";
import { SlideThumbnail } from "./SlideThumbnail";
import { SlideFields } from "./SlideFields";

const LAYOUTS: { value: SlideLayout; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "content", label: "Text" },
  { value: "split", label: "Text + image" },
  { value: "image", label: "Image" },
];

export function SlideEditorWorkspace({
  slides,
  initialSlideId,
  onChangeSlides,
}: {
  slides: Slide[];
  initialSlideId: string | null;
  onChangeSlides: (fn: (slides: Slide[]) => Slide[]) => void;
}) {
  const dialog = useDialog();
  const [selectedId, setSelectedId] = useState<string | null>(initialSlideId ?? slides[0]?.id ?? null);
  const index = slides.findIndex((s) => s.id === selectedId);
  const slide = index >= 0 ? slides[index] : null;

  const updateSlide = (next: Slide) => onChangeSlides((ss) => ss.map((s) => (s.id === next.id ? next : s)));

  const insertAfter = (newSlide: Slide, afterIndex: number) => {
    onChangeSlides((ss) => [...ss.slice(0, afterIndex + 1), newSlide, ...ss.slice(afterIndex + 1)]);
    setSelectedId(newSlide.id);
  };

  const deleteSlide = async (id: string) => {
    const ok = await dialog.confirm({ title: "Delete this slide?", confirmLabel: "Delete", tone: "destructive" });
    if (!ok) return;
    const at = slides.findIndex((s) => s.id === id);
    const remaining = slides.filter((s) => s.id !== id);
    onChangeSlides((ss) => ss.filter((s) => s.id !== id));
    if (id === selectedId) setSelectedId(remaining[Math.min(at, remaining.length - 1)]?.id ?? null);
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside
        aria-label="Slides"
        className="flex max-h-64 shrink-0 flex-col border-b border-os-container md:max-h-none md:w-64 md:border-b-0 md:border-r"
      >
        <div className="flex h-12 shrink-0 items-center justify-between pl-5 pr-3">
          <h3 className="text-xs font-medium text-os-grey">
            Slides <span className="tabular-nums text-os-muted">{slides.length}</span>
          </h3>
          <button
            type="button"
            onClick={() => insertAfter(createSlide("content"), index >= 0 ? index : slides.length - 1)}
            className={buttonClasses("ghost", "sm")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add
          </button>
        </div>
        <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto py-2 pl-2 pr-4">
          {slides.map((s, i) => (
            <SlideThumbnail
              key={s.id}
              slide={s}
              index={i}
              total={slides.length}
              active={s.id === selectedId}
              onSelect={() => setSelectedId(s.id)}
              onMove={(delta) => onChangeSlides((ss) => moveItem(ss, i, delta))}
              onDuplicate={() => insertAfter(duplicateSlide(s), i)}
              onDelete={() => void deleteSlide(s.id)}
            />
          ))}
        </ol>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {slide ? (
          <div className="max-w-4xl px-6 pb-24 pt-8 lg:px-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-lg font-semibold tracking-tight">Slide {index + 1}</h3>
              <Segmented
                ariaLabel="Slide layout"
                size="md"
                value={slide.layout}
                options={LAYOUTS}
                onChange={(layout) => updateSlide(changeSlideLayout(slide, layout))}
              />
            </div>
            <div className="mt-5 overflow-hidden rounded-os-item ring-1 ring-os-container">
              <SlideCanvas slide={slide} number={index + 1} />
            </div>
            <div className="mt-8">
              <SlideFields slide={slide} onChange={updateSlide} />
            </div>
          </div>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <Presentation className="mx-auto h-8 w-8 text-os-muted" aria-hidden />
              <p className="mt-3 text-os-grey">This module has no slides yet.</p>
              <button type="button" onClick={() => insertAfter(createSlide("title"), -1)} className={buttonClasses("primary", "md", "mt-5")}>
                <Plus className="h-4 w-4" aria-hidden />
                Add the first slide
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
