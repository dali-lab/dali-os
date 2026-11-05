import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Group,
  Trash2,
  Ungroup,
} from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { NumberField } from "~/components/ui/NumberField";
import { Segmented } from "~/components/ui/Segmented";
import { Toggle } from "~/components/ui/Toggle";
import { expandToLeaves, isDetached, placedElements, placementOf, slotOf, type Placed } from "~/components/slides/deck/freeform";
import { distributeDeltas, rotatedBounds, type AlignMode, type Axis } from "~/components/slides/deck/geometry";
import { FILL_IDS, FILL_LABELS, SHAPE_LABELS, type FillId } from "~/components/slides/deck/model";
import type { RenderElement, RenderSlide } from "~/components/slides/deck/snapshot";
import { themeById } from "~/components/slides/deck/themes";
import { cn } from "~/lib/cn";
import type { SnapPrefs } from "./snap-prefs";
import type { ReorderDirection } from "~/components/slides/deck/freeform-ops";
import { useState } from "react";
import type { ChartSpec } from "~/components/slides/deck/content";
import { ContentSection } from "./ContentInspector";

export interface InspectorFreeform {
  onPlace: (id: string, placed: Placed) => void;
  onAlign: (mode: AlignMode, to: "slide" | "selection") => void;
  onDistribute: (axis: Axis) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onReorder: (dir: ReorderDirection) => void;
  onSnapBack: (id: string) => void;
  onFill: (fill: FillId) => void;
  onChart?: (id: string, chart: ChartSpec) => void;
  onIcon?: (id: string, name: string) => void;
  onVideo?: (id: string, url: string) => boolean;
  onDeselect: () => void;
  prefs: SnapPrefs;
  onPrefs: (patch: Partial<SnapPrefs>) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-os-grey">{title}</h3>
      {children}
    </section>
  );
}

const ALIGN: Array<{ mode: AlignMode; label: string; icon: typeof AlignStartVertical }> = [
  { mode: "left", label: "Align left", icon: AlignStartVertical },
  { mode: "center", label: "Align center", icon: AlignCenterVertical },
  { mode: "right", label: "Align right", icon: AlignEndVertical },
  { mode: "top", label: "Align top", icon: AlignStartHorizontal },
  { mode: "middle", label: "Align middle", icon: AlignCenterHorizontal },
  { mode: "bottom", label: "Align bottom", icon: AlignEndHorizontal },
];

export function AlignRow({ onAlign, disabled = false }: { onAlign: (mode: AlignMode) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Align" className="flex gap-0.5">
      {ALIGN.map(({ mode, label, icon }) => (
        <IconButton key={mode} label={label} icon={icon} disabled={disabled} onClick={() => onAlign(mode)} />
      ))}
    </div>
  );
}

export const KIND_LABELS: Record<string, string> = { text: "Text", image: "Image", shape: "Shape", group: "Group", chart: "Chart", icon: "Icon", video: "Video" };

/** What the element tab is called: the kind of the one selected item, or a count. */
export function elementTabLabel(slide: RenderSlide | null, selection: string[]): string {
  if (!slide || selection.length === 0) return "Text";
  if (selection.length > 1) return "Selection";
  const el = slide.elements.find((e) => e.id === selection[0]);
  return el ? (KIND_LABELS[el.kind] ?? "Text") : "Text";
}

function selectionNoun(slide: RenderSlide, ids: string[]): string {
  const els = ids.map((id) => slide.elements.find((e) => e.id === id)).filter((e): e is RenderElement => Boolean(e));
  const kinds = new Set(els.map((e) => e.kind));
  const noun = kinds.size === 1 ? { text: "text boxes", image: "images", shape: "shapes", group: "groups", chart: "charts", icon: "icons", video: "videos" }[els[0].kind] ?? "items" : "items";
  return `${ids.length} ${noun}`;
}

function SnapToggles({ prefs, onPrefs }: { prefs: SnapPrefs; onPrefs: (patch: Partial<SnapPrefs>) => void }) {
  return (
    <Section title="Snapping">
      <Toggle tone="os" label="Snap to other items" checked={prefs.items} onChange={(e) => onPrefs({ items: e.target.checked })} />
      <Toggle tone="os" label="Snap to slide margins" checked={prefs.margins} onChange={(e) => onPrefs({ margins: e.target.checked })} />
      <Toggle tone="os" label="Show grid" checked={prefs.grid} onChange={(e) => onPrefs({ grid: e.target.checked })} />
      <p className="text-xs text-os-grey">Hold ⌘ while dragging to skip snapping.</p>
    </Section>
  );
}

function PositionFields({ placed, onPlace, disabled }: { placed: Placed; onPlace: (p: Placed) => void; disabled: boolean }) {
  const set = (patch: Partial<Placed>) => onPlace({ ...placed, ...patch });
  return (
    <Section title="Position">
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField label="X" value={placed.x} disabled={disabled} onCommit={(x) => set({ x })} />
        <NumberField label="Y" value={placed.y} disabled={disabled} onCommit={(y) => set({ y })} />
        <NumberField label="W" value={placed.w} min={1} disabled={disabled} onCommit={(w) => set({ w })} />
        <NumberField label="H" value={placed.h} min={1} disabled={disabled} onCommit={(h) => set({ h })} />
        <NumberField label="R" ariaLabel="Rotation" value={placed.rot} min={-180} max={180} disabled={disabled} onCommit={(rot) => set({ rot })} />
      </div>
    </Section>
  );
}

function OrderButtons({ freeform }: { freeform: InspectorFreeform }) {
  return (
    <Section title="Order">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => freeform.onReorder("forward")}>
          <ArrowUpToLine className="h-3.5 w-3.5" aria-hidden />
          Bring forward
        </Button>
        <Button variant="secondary" size="sm" onClick={() => freeform.onReorder("backward")}>
          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden />
          Send back
        </Button>
      </div>
    </Section>
  );
}

function FillSwatches({ value, themeId, onPick }: { value: FillId; themeId: string; onPick: (fill: FillId) => void }) {
  const theme = themeById(themeId);
  return (
    <Section title="Fill">
      <div role="group" aria-label="Fill" className="flex flex-wrap gap-1.5">
        {FILL_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={FILL_LABELS[id]}
            aria-pressed={value === id}
            onClick={() => onPick(id)}
            className={cn("h-7 w-7 rounded-full border-2 transition-colors", value === id ? "border-os-accent" : "border-os-container hover:border-os-grey")}
            style={{ background: theme.colors[id] }}
          />
        ))}
      </div>
    </Section>
  );
}

function MultiView({ slide, selection, freeform, editable }: { slide: RenderSlide; selection: string[]; freeform: InspectorFreeform; editable: boolean }) {
  const [to, setTo] = useState<"selection" | "slide">("selection");
  const leaves = expandToLeaves(slide, selection);
  const boxes = placedElements(slide)
    .filter((i) => leaves.includes(i.element.id))
    .map((i) => rotatedBounds(i.placed));
  const gap = (axis: Axis) => (boxes.length >= 3 ? Math.round(distributeDeltas(boxes, axis).gap) : null);
  const grouped = selection.some((id) => slide.elements.find((e) => e.id === id)?.kind === "group");
  const allOneGroup = selection.length === 1 && grouped;
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium" data-selection-count>{selectionNoun(slide, selection)}</h3>
        <Button variant="ghost" size="xs" onClick={freeform.onDeselect}>
          Deselect
        </Button>
      </div>
      <Section title="Align to">
        <Segmented
          ariaLabel="Align to"
          fullWidth
          value={to}
          onChange={setTo}
          options={[
            { value: "selection", label: "Selection", disabled: boxes.length < 2 },
            { value: "slide", label: "Slide" },
          ]}
        />
        <AlignRow disabled={!editable} onAlign={(mode) => freeform.onAlign(mode, to === "selection" && boxes.length < 2 ? "slide" : to)} />
      </Section>
      <Section title="Distribute">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!editable || boxes.length < 3} onClick={() => freeform.onDistribute("x")}>
            <AlignHorizontalSpaceBetween className="h-3.5 w-3.5" aria-hidden />
            Across
          </Button>
          <Button variant="secondary" size="sm" disabled={!editable || boxes.length < 3} onClick={() => freeform.onDistribute("y")}>
            <AlignVerticalSpaceBetween className="h-3.5 w-3.5" aria-hidden />
            Down
          </Button>
        </div>
        {boxes.length >= 3 && (
          <p className="text-xs text-os-grey">
            Space between: {gap("x")} across, {gap("y")} down
          </p>
        )}
      </Section>
      <Section title="Arrange">
        <div className="flex flex-wrap gap-2">
          {allOneGroup ? (
            <Button variant="secondary" size="sm" disabled={!editable} onClick={freeform.onUngroup}>
              <Ungroup className="h-3.5 w-3.5" aria-hidden />
              Ungroup
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={!editable || leaves.length < 2} onClick={freeform.onGroup}>
              <Group className="h-3.5 w-3.5" aria-hidden />
              Group
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={!editable} onClick={freeform.onDuplicate}>
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Duplicate
          </Button>
        </div>
      </Section>
      <OrderButtons freeform={freeform} />
      <p className="text-xs text-os-grey">Shift-click to add items, or drag across the slide to select several.</p>
    </>
  );
}

/** The inspector's element tab: position, alignment, order and fill for what is selected, and the multi-select tools. */
export function ElementView({ slide, themeId, selection, editable, freeform }: { slide: RenderSlide; themeId: string; selection: string[]; editable: boolean; freeform: InspectorFreeform }) {
  if (selection.length > 1 || (selection.length === 1 && slide.elements.find((e) => e.id === selection[0])?.kind === "group")) {
    return <MultiView slide={slide} selection={selection} freeform={freeform} editable={editable} />;
  }
  const el = slide.elements.find((e) => e.id === selection[0]);
  if (!el) return null;
  const placed = placementOf(slide.layoutId, el);
  const slot = slotOf(slide.layoutId, el.slot);
  return (
    <>
      {el.kind === "shape" && (
        <p className="text-sm font-medium">{SHAPE_LABELS[el.shape ?? "rect"]}</p>
      )}
      {slot && isDetached(el) && (
        <div role="note" className="flex flex-col items-start gap-1.5 rounded-lg border border-os-container bg-os-hover p-2 text-xs text-os-grey">
          <span>Moved off the {slot.slot} slot. It keeps its spot if you change layouts.</span>
          <Button variant="ghost" size="xs" disabled={!editable} onClick={() => freeform.onSnapBack(el.id)}>
            Snap back to layout
          </Button>
        </div>
      )}
      {placed && <PositionFields placed={placed} disabled={!editable} onPlace={(p) => freeform.onPlace(el.id, p)} />}
      <Section title="Align to slide">
        <AlignRow disabled={!editable} onAlign={(mode) => freeform.onAlign(mode, "slide")} />
      </Section>
      <OrderButtons freeform={freeform} />
      <ContentSection element={el} editable={editable} freeform={freeform} />
      {(el.kind === "shape" || el.kind === "icon") && <FillSwatches value={el.fill ?? "accent"} themeId={themeId} onPick={freeform.onFill} />}
      <SnapToggles prefs={freeform.prefs} onPrefs={freeform.onPrefs} />
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={freeform.onDuplicate}>
            <Copy className="h-3.5 w-3.5" aria-hidden />
            Duplicate
          </Button>
          {!el.slot && (
            <Button variant="secondary" size="sm" onClick={freeform.onDelete}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </Button>
          )}
        </div>
      )}
    </>
  );
}

