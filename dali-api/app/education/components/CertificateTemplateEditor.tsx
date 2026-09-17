import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  CERTIFICATE_FIELD_KEYS,
  CERTIFICATE_FIELD_LABELS,
  CERTIFICATE_FIELD_SAMPLE,
  type PlacedField,
} from "~/education/lib/certificate-fields";
import { Button } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";

// WYSIWYG certificate template editor. Fields are placed as fraction-based
// anchors (x/y in 0..1) over a scaled background image. The preview mirrors
// the PDF renderer exactly: page dimensions = background pixel size, text
// anchored at (x·W, y·H) with align shifting the anchor.

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
  const [fields, setFields] = useState<PlacedField[]>(initialFields);
  const [selected, setSelected] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // Drag state in a ref so pointer-move updates don't cause re-renders.
  const drag = useRef<{ fieldIndex: number } | null>(null);

  // Measure container width for responsive scaling.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = containerWidth !== null ? containerWidth / bgWidth : 1;

  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const isSaving = fetcher.state !== "idle";
  const savedOk = fetcher.state === "idle" && (fetcher.data as { ok?: boolean } | undefined)?.ok === true;
  const saveError = (fetcher.data as { error?: string } | undefined)?.error;

  function updateField(i: number, patch: Partial<PlacedField>) {
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function addField(key: PlacedField["key"]) {
    const newField: PlacedField = {
      key,
      x: 0.5,
      y: 0.5,
      fontSize: Math.round(bgHeight * 0.05),
      color: "#1c2b4a",
      align: "center",
      bold: true,
    };
    setFields((prev) => {
      const next = [...prev, newField];
      setSelected(next.length - 1);
      return next;
    });
  }

  function removeField(i: number) {
    setFields((prev) => prev.filter((_, idx) => idx !== i));
    setSelected(null);
  }

  // Pointer events for drag. The inner div is CSS-scaled, so we divide
  // client coords by `scale` to get bg-pixel coordinates.
  function onPointerDown(e: React.PointerEvent, i: number) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { fieldIndex: i };
    setSelected(i);
  }

  function onPointerMove(e: React.PointerEvent, i: number) {
    if (!drag.current || drag.current.fieldIndex !== i) return;
    const inner = innerRef.current;
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / scale;
    const rawY = (e.clientY - rect.top) / scale;
    const newX = Math.max(0, Math.min(1, rawX / bgWidth));
    const newY = Math.max(0, Math.min(1, rawY / bgHeight));
    updateField(i, { x: newX, y: newY });
  }

  function onPointerUp() {
    drag.current = null;
  }

  const placedKeys = new Set(fields.map((f) => f.key));
  const availableKeys = CERTIFICATE_FIELD_KEYS.filter((k) => !placedKeys.has(k));

  const sel = selected !== null ? fields[selected] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Save bar */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={isSaving}
          onClick={() =>
            fetcher.submit(
              { intent: "save-fields", fields: JSON.stringify(fields) },
              { method: "post" },
            )
          }
        >
          {isSaving ? "Saving…" : "Save layout"}
        </Button>
        {savedOk && <span className="text-xs text-muted-foreground">Saved</span>}
        {saveError && (
          <span className="text-xs text-destructive">{saveError}</span>
        )}
      </div>

      {/* Main layout: preview + side panel */}
      <div className="flex gap-6 items-start">
        {/* Preview */}
        <div className="flex-1 min-w-0">
          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-lg border border-border bg-muted"
            style={{
              width: "100%",
              height: containerWidth !== null ? bgHeight * scale : 0,
            }}
          >
            {containerWidth !== null && (
              <div
                ref={innerRef}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: bgWidth,
                  height: bgHeight,
                  transformOrigin: "top left",
                  transform: `scale(${scale})`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bgUrl}
                  alt="Certificate background"
                  style={{ width: bgWidth, height: bgHeight, display: "block" }}
                  draggable={false}
                />
                {fields.map((f, i) => {
                  const alignTransform =
                    f.align === "center"
                      ? "translateX(-50%)"
                      : f.align === "right"
                        ? "translateX(-100%)"
                        : undefined;
                  return (
                    <span
                      key={i}
                      style={{
                        position: "absolute",
                        left: f.x * bgWidth,
                        top: f.y * bgHeight,
                        fontSize: f.fontSize,
                        color: f.color,
                        fontWeight: f.bold ? 700 : 400,
                        fontFamily: "Helvetica, Arial, sans-serif",
                        whiteSpace: "nowrap",
                        cursor: "grab",
                        userSelect: "none",
                        transform: alignTransform,
                        outline: selected === i ? "2px dashed #e85d26" : undefined,
                        outlineOffset: selected === i ? 2 : undefined,
                      }}
                      onPointerDown={(e) => onPointerDown(e, i)}
                      onPointerMove={(e) => onPointerMove(e, i)}
                      onPointerUp={onPointerUp}
                    >
                      {CERTIFICATE_FIELD_SAMPLE[f.key]}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag fields to reposition. Select a field to edit its style.
          </p>
        </div>

        {/* Side panel */}
        <div className="w-64 shrink-0 flex flex-col gap-4">
          {/* Add field */}
          {availableKeys.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Add field</p>
              {availableKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => addField(key)}
                  className="text-left text-sm px-2 py-1.5 rounded-md border border-border hover:bg-muted hover:text-accent-coral transition-colors"
                >
                  {CERTIFICATE_FIELD_LABELS[key]}
                </button>
              ))}
            </div>
          )}

          {/* Selected field controls */}
          {sel !== null && selected !== null && (
            <div className="bg-card border border-border rounded-lg p-3 flex flex-col gap-3">
              <p className="text-xs font-semibold text-foreground">
                Editing:{" "}
                <span className="text-accent-coral">
                  {CERTIFICATE_FIELD_LABELS[sel.key]}
                </span>
              </p>

              <label className="block">
                <span className="text-xs text-muted-foreground">Font size (px)</span>
                <input
                  type="number"
                  min={6}
                  max={200}
                  value={sel.fontSize}
                  onChange={(e) =>
                    updateField(selected, { fontSize: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-xs text-muted-foreground">Color</span>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={sel.color}
                    onChange={(e) => updateField(selected, { color: e.target.value })}
                    className="h-8 w-12 cursor-pointer rounded border border-border bg-card p-0.5"
                  />
                  <span className="text-xs text-muted-foreground font-mono">
                    {sel.color}
                  </span>
                </div>
              </label>

              <label className="block">
                <span className="text-xs text-muted-foreground">Alignment</span>
                <Select
                  value={sel.align}
                  onChange={(v) =>
                    updateField(selected, {
                      align: v as "left" | "center" | "right",
                    })
                  }
                  options={[
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                  buttonClassName="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>

              <Toggle
                checked={sel.bold}
                onChange={(e) => updateField(selected, { bold: e.target.checked })}
                label="Bold"
              />

              <button
                type="button"
                onClick={() => removeField(selected)}
                className="text-left text-xs text-destructive hover:underline"
              >
                Remove field
              </button>
            </div>
          )}

          {fields.length === 0 && availableKeys.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              All fields have been placed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
