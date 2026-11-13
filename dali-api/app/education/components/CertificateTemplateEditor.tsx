import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bold, Trash2 } from "lucide-react";
import { FreeformLayer } from "~/components/slides/collab/FreeformLayer";
import { AlignRow } from "~/components/slides/collab/ElementInspector";
import { inEditable } from "~/components/slides/collab/gesture";
import { useSnapPrefs } from "~/components/slides/collab/snap-prefs";
import type { PlacedLive } from "~/components/slides/deck/freeform";
import { alignDeltas, boundsOf, nudgeDelta, type AlignMode, type Handle, type Stage } from "~/components/slides/deck/geometry";
import { Button } from "~/components/ui/Button";
import { ColorField } from "~/components/ui/ColorField";
import { IconButton } from "~/components/ui/IconButton";
import { NumberField } from "~/components/ui/NumberField";
import { Segmented } from "~/components/ui/Segmented";
import { Toggle } from "~/components/ui/Toggle";
import {
  CERTIFICATE_FIELD_KEYS,
  CERTIFICATE_FIELD_LABELS,
  CERTIFICATE_FIELD_SAMPLE,
  LINE_HEIGHT,
  shrinkFontSize,
  upgradeLegacyField,
  type CertificateFieldKey,
  type FieldFit,
  type PlacedField,
} from "~/education/lib/certificate-fields";
import {
  applyPlacements,
  fieldsToSlide,
  newField,
  nudgeFields,
  pushHistory,
  redoHistory,
  startHistory,
  undoHistory,
  type History,
} from "~/education/lib/certificate-editor-model";
import { useCertificateAutosave } from "~/education/lib/use-certificate-autosave";

export const CERTIFICATE_SNAP_KEY = "dali.certificates.snap";

const EAST_WEST: Handle[] = ["e", "w"];
const handlesFor = () => EAST_WEST;

type Heights = Partial<Record<CertificateFieldKey, number>>;

function FieldText({
  field,
  rect,
  bgW,
  onHeight,
}: {
  field: PlacedField;
  rect: { x: number; y: number; w: number };
  bgW: number;
  onHeight: (key: CertificateFieldKey, h: number) => void;
}) {
  const text = CERTIFICATE_FIELD_SAMPLE[field.key];
  const nodeRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState(field.fontSize);

  const measure = useCallback(() => {
    const node = nodeRef.current;
    const stagePx = node?.parentElement?.offsetWidth ?? 0;
    if (!node || !stagePx) return;
    if (field.fit === "shrink" && probeRef.current) {
      setSize(shrinkFontSize(field.fontSize, node.offsetWidth, probeRef.current.offsetWidth));
    } else setSize(field.fontSize);
    if (node.offsetHeight) onHeight(field.key, (node.offsetHeight * bgW) / stagePx);
  }, [field.fit, field.fontSize, field.key, bgW, onHeight]);

  useEffect(() => {
    measure();
    const parent = nodeRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [measure, rect.w, field.bold, size]);

  const shownSize = field.fit === "shrink" ? size : field.fontSize;
  const font = (px: number) => ({
    fontSize: `${(px / bgW) * 100}cqw`,
    fontWeight: field.bold ? 700 : 400,
    fontFamily: "Helvetica, Arial, sans-serif",
    lineHeight: LINE_HEIGHT,
  });
  return (
    <>
      {field.fit === "shrink" && (
        <span ref={probeRef} aria-hidden className="pointer-events-none invisible absolute whitespace-nowrap" style={font(field.fontSize)}>
          {text}
        </span>
      )}
      <div
        ref={nodeRef}
        data-field-text={field.key}
        className="pointer-events-none absolute select-none overflow-hidden break-words"
        style={{
          ...font(shownSize),
          left: `${rect.x}%`,
          top: `${rect.y}%`,
          width: `${rect.w}%`,
          color: field.color,
          textAlign: field.align,
        }}
      >
        {text}
      </div>
    </>
  );
}

export function CertificateTemplateEditor({
  bgUrl,
  bgWidth,
  bgHeight,
  initialFields,
}: {
  templateId: string;
  bgUrl: string;
  bgWidth: number;
  bgHeight: number;
  initialFields: PlacedField[];
}) {
  const [history, setHistory] = useState<History>(() => startHistory(initialFields.map(upgradeLegacyField)));
  const fields = history.present;
  const [selection, setSelection] = useState<string[]>([]);
  const [live, setLive] = useState<Map<string, PlacedLive> | null>(null);
  const [heights, setHeights] = useState<Heights>({});
  const [alignTo, setAlignTo] = useState<"page" | "selection">("page");
  const [prefs, onPrefs] = useSnapPrefs(CERTIFICATE_SNAP_KEY);
  const stageRef = useRef<HTMLDivElement>(null);
  const status = useCertificateAutosave(fields);

  const stage = useMemo<Stage>(() => ({ w: bgWidth, h: bgHeight }), [bgWidth, bgHeight]);
  const slide = useMemo(() => fieldsToSlide(fields, bgWidth, bgHeight, heights, live), [fields, bgWidth, bgHeight, heights, live]);
  const committedSlide = useMemo(() => fieldsToSlide(fields, bgWidth, bgHeight, heights), [fields, bgWidth, bgHeight, heights]);

  const onHeight = useCallback((key: CertificateFieldKey, h: number) => {
    setHeights((prev) => (Math.abs((prev[key] ?? 0) - h) < 0.5 ? prev : { ...prev, [key]: h }));
  }, []);

  const commit = useCallback((next: PlacedField[]) => setHistory((h) => pushHistory(h, next)), []);

  const edit = (fn: (f: PlacedField) => PlacedField) =>
    commit(fields.map((f) => (selection.includes(f.key) ? fn(f) : f)));

  const addField = (key: CertificateFieldKey) => {
    commit([...fields, newField(key, bgHeight)]);
    setSelection([key]);
  };

  const removeSelected = useCallback(() => {
    if (selection.length === 0) return;
    commit(fields.filter((f) => !selection.includes(f.key)));
    setSelection([]);
  }, [selection, fields, commit]);

  const align = (mode: AlignMode) => {
    const chosen = committedSlide.elements.filter((e) => selection.includes(e.id));
    if (chosen.length === 0) return;
    const rects = chosen.map((e) => ({ x: e.x!, y: e.y!, w: e.w!, h: e.h! }));
    const to = alignTo === "selection" && rects.length > 1 ? boundsOf(rects) : { x: 0, y: 0, w: bgWidth, h: bgHeight };
    const deltas = alignDeltas(rects, to, mode);
    const updates: Record<string, { x: number; y: number; w: number; h: number; rot: number }> = {};
    chosen.forEach((e, i) => {
      updates[e.id] = { x: rects[i].x + deltas[i].dx, y: rects[i].y + deltas[i].dy, w: rects[i].w, h: rects[i].h, rot: 0 };
    });
    commit(applyPlacements(fields, updates, bgWidth, bgHeight));
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (inEditable(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      setHistory((h) => (e.shiftKey ? redoHistory(h) : undoHistory(h)));
      return;
    }
    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelection(fields.map((f) => f.key));
      return;
    }
    if (mod) return;
    if (e.key === "Escape") return setSelection([]);
    if (selection.length === 0) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return removeSelected();
    }
    const nudge = nudgeDelta(e.key, e.shiftKey);
    if (nudge) {
      e.preventDefault();
      commit(nudgeFields(fields, selection, nudge.dx, nudge.dy, bgWidth, bgHeight));
    }
  };

  const refocus = (e: React.PointerEvent) => {
    if (inEditable(e.target)) return;
    setTimeout(() => stageRef.current?.focus({ preventScroll: true }), 0);
  };

  const selected = fields.filter((f) => selection.includes(f.key));
  const first = selected[0];
  const placedKeys = new Set(fields.map((f) => f.key));
  const availableKeys = CERTIFICATE_FIELD_KEYS.filter((k) => !placedKeys.has(k));

  return (
    <div className="flex flex-col gap-3">
      <div className="h-4 text-xs" role="status">
        {status.state === "saving" && <span className="text-muted-foreground">Saving…</span>}
        {status.state === "saved" && <span className="text-muted-foreground">Saved</span>}
        {status.state === "error" && <span className="text-destructive">{status.error}</span>}
      </div>

      <div className="flex flex-col items-start gap-6 md:flex-row">
        <div className="w-full min-w-0 flex-1">
          <div
            ref={stageRef}
            tabIndex={0}
            data-certificate-stage
            aria-label="Certificate layout"
            onKeyDown={onKeyDown}
            onPointerDownCapture={refocus}
            className="relative w-full overflow-hidden rounded-lg border border-border bg-muted [container-type:inline-size] focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40"
            style={{ aspectRatio: `${bgWidth} / ${bgHeight}` }}
          >
            <img src={bgUrl} alt="Certificate background" draggable={false} className="absolute inset-0 h-full w-full select-none" />
            {fields.map((f) => {
              const el = slide.elements.find((e) => e.id === f.key)!;
              return (
                <FieldText
                  key={f.key}
                  field={f}
                  bgW={bgWidth}
                  onHeight={onHeight}
                  rect={{ x: (el.x! / bgWidth) * 100, y: (el.y! / bgHeight) * 100, w: (el.w! / bgWidth) * 100 }}
                />
              );
            })}
            <FreeformLayer
              slide={slide}
              stage={stage}
              rotatable={false}
              handlesFor={handlesFor}
              selection={selection}
              onSelect={setSelection}
              editingId={null}
              prefs={prefs}
              onLive={setLive}
              onCommit={(updates, opts) => {
                if (opts?.duplicate) return;
                commit(applyPlacements(fields, updates, bgWidth, bgHeight));
              }}
              renderBar={() =>
                first && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-os-container bg-os-card p-1.5 shadow-sm">
                    <NumberField
                      label="T"
                      ariaLabel="Font size"
                      value={first.fontSize}
                      min={6}
                      max={400}
                      className="w-20"
                      onCommit={(fontSize) => edit((f) => ({ ...f, fontSize }))}
                    />
                    <IconButton
                      label="Bold"
                      icon={Bold}
                      aria-pressed={first.bold}
                      className={first.bold ? "bg-muted text-foreground" : undefined}
                      onClick={() => edit((f) => ({ ...f, bold: !first.bold }))}
                    />
                    <Segmented
                      ariaLabel="Text align"
                      value={first.align}
                      onChange={(align) => edit((f) => ({ ...f, align }))}
                      options={[
                        { value: "left", label: "Left" },
                        { value: "center", label: "Center" },
                        { value: "right", label: "Right" },
                      ]}
                    />
                    <ColorField value={first.color} onChange={(color) => edit((f) => ({ ...f, color }))} />
                    <Segmented<FieldFit>
                      ariaLabel="Text fit"
                      value={first.fit ?? "wrap"}
                      onChange={(fit) => edit((f) => ({ ...f, fit }))}
                      options={[
                        { value: "wrap", label: "Wrap" },
                        { value: "shrink", label: "Shrink" },
                      ]}
                    />
                  </div>
                )
              }
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag fields to move them and drag a side handle to set the width. Shift-click or drag across to select several. Arrow keys nudge, Delete removes, and ⌘Z undoes.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Changes save on their own. Saving a template restyles every certificate already issued from it.
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 md:w-64">
          {availableKeys.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
              <p className="text-xs font-semibold text-muted-foreground">Add field</p>
              {availableKeys.map((key) => (
                <Button key={key} type="button" variant="secondary" size="sm" className="justify-start" onClick={() => addField(key)}>
                  {CERTIFICATE_FIELD_LABELS[key]}
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-semibold text-muted-foreground">Align</p>
            {selected.length > 1 && (
              <Segmented<"page" | "selection">
                ariaLabel="Align to"
                value={alignTo}
                onChange={setAlignTo}
                options={[
                  { value: "page", label: "Page" },
                  { value: "selection", label: "Each other" },
                ]}
              />
            )}
            <AlignRow disabled={selected.length === 0} onAlign={align} />
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
            <p className="text-xs font-semibold text-muted-foreground">Snapping</p>
            <Toggle tone="os" label="Snap to other fields" checked={prefs.items} onChange={(e) => onPrefs({ items: e.target.checked })} />
            <Toggle tone="os" label="Show grid" checked={prefs.grid} onChange={(e) => onPrefs({ grid: e.target.checked })} />
            <p className="text-xs text-muted-foreground">Hold ⌘ while dragging to skip snapping.</p>
          </div>

          {selected.length > 0 && (
            <Button type="button" variant="secondary" size="sm" onClick={removeSelected}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {selected.length > 1 ? "Remove fields" : "Remove field"}
            </Button>
          )}
          {fields.length > 0 && selected.length === 0 && <p className="text-xs text-muted-foreground">Select a field to edit its style.</p>}
        </div>
      </div>
    </div>
  );
}
