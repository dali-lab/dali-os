import { useEffect, useState } from "react";
import { Segmented } from "~/components/ui/Segmented";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { layoutById } from "~/components/slides/deck/layouts";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";
import { TEXT_STYLE_IDS, TEXT_STYLE_LABELS, THEMES, type TextStyleId } from "~/components/slides/deck/themes";
import { cn } from "~/lib/cn";
import { ElementView, elementTabLabel, type InspectorFreeform } from "./ElementInspector";
import { LayoutGrid } from "./LayoutPicker";
import { BackgroundSection, TransitionSection } from "./SlideSettings";
import type { SlideBackground, SlideTransition } from "~/components/slides/deck/slide-meta";

type Tab = "slide" | "text" | "deck";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-os-grey">{title}</h3>
      {children}
    </section>
  );
}

function ThemeCards({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={value === t.id}
          onClick={() => onPick(t.id)}
          className={cn(
            "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm transition-colors",
            value === t.id ? "border-os-accent bg-os-hover" : "border-os-container hover:bg-os-hover",
          )}
        >
          <span
            aria-hidden
            className="h-6 w-9 shrink-0 rounded-[4px] border border-os-container"
            style={{ background: t.colors.ground, boxShadow: `inset 0 -6px 0 ${t.colors.accent}` }}
          />
          {t.name}
        </button>
      ))}
    </div>
  );
}

const WITH_SLIDE = "0";
const MIN_STEP_OPTIONS = 3;

function Appears({
  slide,
  element,
  bullets,
  editable,
  onBuild,
  onBuildBullets,
}: {
  slide: RenderSlide;
  element: RenderElement | undefined;
  bullets: boolean;
  editable: boolean;
  onBuild: (build: number | null) => void;
  onBuildBullets: (on: boolean) => void;
}) {
  const highest = Math.max(0, ...slide.elements.map((e) => e.build ?? 0));
  const count = Math.max(MIN_STEP_OPTIONS, highest + 1);
  const options = [
    { value: WITH_SLIDE, label: "With slide" },
    ...Array.from({ length: count }, (_, i) => ({ value: String(i + 1), label: `Step ${i + 1}` })),
  ];
  return (
    <Section title="Appears">
      <Select
        ariaLabel="Appears"
        value={String(element?.build ?? 0)}
        options={options}
        disabled={!editable}
        onChange={(v) => onBuild(v === WITH_SLIDE ? null : Number(v))}
      />
      {bullets && (
        <Toggle
          tone="os"
          label="Bullets one at a time"
          checked={element?.buildBullets === true}
          disabled={!editable}
          onChange={(e) => onBuildBullets(e.target.checked)}
        />
      )}
    </Section>
  );
}

export function Inspector({
  slide,
  themeId,
  slideCount,
  selection,
  freeform,
  editable,
  onLayout,
  onTheme,
  onTextStyle,
  onPickImage,
  onClearImage,
  onBuild,
  onBuildBullets,
  onDownloadPdf,
  onImport,
  importing = false,
  downloadHref,
  onBackground,
  onPickBackground,
  onTransition,
  onPreviewTransition,
}: {
  slide: RenderSlide | null;
  themeId: string;
  slideCount: number;
  selection: string[];
  freeform?: InspectorFreeform;
  editable: boolean;
  onLayout: (layoutId: string) => void;
  onTheme: (themeId: string) => void;
  onTextStyle: (slot: string, style: TextStyleId | null) => void;
  onPickImage: () => void;
  onClearImage: () => void;
  onBuild?: (slot: string, build: number | null) => void;
  onBuildBullets?: (slot: string, on: boolean) => void;
  onDownloadPdf?: (withNotes: boolean) => void;
  onImport?: () => void;
  importing?: boolean;
  downloadHref?: string;
  onBackground?: (background: SlideBackground | null) => void;
  onPickBackground?: () => void;
  onTransition?: (transition: SlideTransition | null) => void;
  onPreviewTransition?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("slide");
  const selectionKey = selection.join("|");
  useEffect(() => {
    if (selectionKey) setTab("text");
  }, [selectionKey]);
  const layout = slide ? layoutById(slide.layoutId) : null;
  const imageSlot = layout?.slots.find((s) => s.kind === "image");
  const image = slide?.elements.find((e) => e.slot === "image");
  const element = selection.length === 1 ? slide?.elements.find((e) => e.id === selection[0]) : undefined;
  const textSlot = element?.kind === "text" ? { slot: element.id, style: layout?.slots.find((s) => s.slot === element.slot)?.style ?? ("body" as TextStyleId) } : undefined;
  const activeStyle = element?.textStyle ?? textSlot?.style ?? null;

  return (
    <aside aria-label="Inspector" className="flex min-h-0 w-62 shrink-0 flex-col gap-4 overflow-y-auto border-l border-os-container p-3">
      <Segmented
        ariaLabel="Inspector"
        fullWidth
        value={tab}
        onChange={setTab}
        options={[
          { value: "slide", label: "Slide" },
          { value: "text", label: elementTabLabel(slide, selection) },
          { value: "deck", label: "Deck" },
        ]}
      />
      {tab === "slide" && (
        <>
          <Section title="Layout">
            {slide ? <LayoutGrid value={slide.layoutId} themeId={themeId} onPick={editable ? onLayout : () => {}} /> : <p className="text-sm text-os-grey">No slide selected.</p>}
          </Section>
          {imageSlot && editable && (
            <Section title="Image">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={onPickImage}>
                  {image?.src ? "Replace image" : "Add image"}
                </Button>
                {image?.src && (
                  <Button variant="ghost" size="sm" onClick={onClearImage}>
                    Remove
                  </Button>
                )}
              </div>
            </Section>
          )}
          {imageSlot && slide && onBuild && (
            <Appears
              slide={slide}
              element={image}
              bullets={false}
              editable={editable}
              onBuild={(b) => onBuild(imageSlot.slot, b)}
              onBuildBullets={() => {}}
            />
          )}
          {slide && onBackground && onPickBackground && <BackgroundSection slide={slide} themeId={themeId} editable={editable} onChange={onBackground} onPickImage={onPickBackground} />}
          {slide && onTransition && <TransitionSection slide={slide} editable={editable} onChange={onTransition} onPreview={onPreviewTransition ?? (() => {})} />}
          <Section title="Theme">
            <ThemeCards value={themeId} onPick={editable ? onTheme : () => {}} />
          </Section>
        </>
      )}
      {tab === "text" && (
        <>
          {textSlot && (
            <Section title="Text style">
              <div className="flex flex-col gap-1.5" role="group" aria-label="Text style">
                {TEXT_STYLE_IDS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!editable}
                    aria-pressed={activeStyle === id}
                    onClick={() => onTextStyle(textSlot.slot, id === textSlot.style ? null : id)}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-left text-sm transition-colors",
                      activeStyle === id ? "border-os-accent bg-os-hover" : "border-os-container hover:bg-os-hover",
                    )}
                  >
                    {TEXT_STYLE_LABELS[id]}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {selection.length === 0 && (
            <Section title="Text style">
              <p className="text-sm text-os-grey">Click a text box on the slide to change its style.</p>
            </Section>
          )}
          {textSlot && slide && onBuild && (
            <Appears
              slide={slide}
              element={element}
              bullets
              editable={editable}
              onBuild={(b) => onBuild(textSlot.slot, b)}
              onBuildBullets={(on) => onBuildBullets?.(textSlot.slot, on)}
            />
          )}
          {slide && freeform && selection.length > 0 && (
            <>
              {element && element.kind !== "text" && element.kind !== "group" && onBuild && (
                <Appears slide={slide} element={element} bullets={false} editable={editable} onBuild={(b) => onBuild(element.id, b)} onBuildBullets={() => {}} />
              )}
              <ElementView slide={slide} themeId={themeId} selection={selection} editable={editable} freeform={freeform} />
            </>
          )}
        </>
      )}
      {tab === "deck" && (
        <>
          <Section title="Theme">
            <ThemeCards value={themeId} onPick={editable ? onTheme : () => {}} />
          </Section>
          <p className="text-sm text-os-grey">
            {slideCount} {slideCount === 1 ? "slide" : "slides"}
          </p>
          {onDownloadPdf && (
            <Section title="Export">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => onDownloadPdf(false)}>
                  Download PDF
                </Button>
                {editable && (
                  <Button variant="secondary" size="sm" onClick={() => onDownloadPdf(true)}>
                    Download PDF with notes
                  </Button>
                )}
              </div>
            </Section>
          )}
          {(downloadHref || (editable && onImport)) && (
            <Section title="PowerPoint">
              <div className="flex flex-wrap gap-2">
                {downloadHref && (
                  <Button variant="secondary" size="sm" onClick={() => window.location.assign(downloadHref)}>
                    Download PowerPoint
                  </Button>
                )}
                {editable && onImport && (
                  <Button variant="secondary" size="sm" disabled={importing} onClick={onImport}>
                    Import slides
                  </Button>
                )}
              </div>
            </Section>
          )}
        </>
      )}
    </aside>
  );
}
