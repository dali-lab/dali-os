import { Check, GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOutsideDismiss } from "~/components/ui/floating";
import { TONES, type ComponentData } from "../kinds";

export function StatsEditor({
  draft,
  setDraft,
  onSave,
  onClose,
}: {
  draft: ComponentData;
  setDraft: React.Dispatch<React.SetStateAction<ComponentData>>;
  onSave: (data: ComponentData) => void;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const [focusNew, setFocusNew] = useState(false);
  const valueRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!focusNew) return;
    valueRefs.current[draft.items.length - 1]?.focus();
    setFocusNew(false);
  }, [focusNew, draft.items.length]);

  useOutsideDismiss(sel !== null, ".dali-cmp-stat--edit", () => setSel(null));

  const setItem = (i: number, patch: Record<string, string>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length || from === to) return;
    setDraft((d) => {
      const items = [...d.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it!);
      return { ...d, items };
    });
    setSel((c) => (c === from ? to : c));
  };

  return (
    <div className="dali-cmp-stats-edit">
      <div className="dali-cmp-grid dali-cmp-grid--edit">
        {draft.items.map((it, i) => (
          <div
            key={i}
            draggable={dragReady === i}
            className={`dali-cmp-stat dali-cmp-stat--edit dali-cmp-tone--${it.tone || "neutral"}${sel === i ? " dali-cmp-stat--selected" : ""}${dragFrom === i ? " dali-cmp-stat--dragging" : ""}`}
            onFocusCapture={() => setSel(i)}
            onClick={() => setSel(i)}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                const to = i + (e.key === "ArrowLeft" ? -1 : 1);
                move(i, to);
                requestAnimationFrame(() => valueRefs.current[to]?.focus());
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", String(i));
              setDragFrom(i);
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              if (dragFrom !== i) {
                move(dragFrom, i);
                setDragFrom(i);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragFrom(null);
              setDragReady(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragReady(null);
            }}
          >
            <input
              ref={(el) => {
                valueRefs.current[i] = el;
              }}
              aria-label={`Stat ${i + 1} number`}
              value={it.value ?? ""}
              placeholder="0"
              onChange={(e) => setItem(i, { value: e.target.value })}
              className="dali-cmp-stat__value dali-cmp-stat__field"
            />
            <input
              aria-label={`Stat ${i + 1} label`}
              value={it.label ?? ""}
              placeholder="Label"
              onChange={(e) => setItem(i, { label: e.target.value })}
              className="dali-cmp-sub dali-cmp-stat__field"
            />
            <button
              type="button"
              className="dali-cmp-stat__tool dali-cmp-stat__grip"
              aria-label={`Reorder stat ${i + 1}. Drag, or use Alt plus the arrow keys.`}
              onMouseDown={() => setDragReady(i)}
              onMouseUp={() => setDragReady(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  e.stopPropagation();
                  move(i, i + (e.key === "ArrowLeft" ? -1 : 1));
                }
              }}
            >
              <GripVertical size={11} strokeWidth={1.5} aria-hidden />
            </button>
            <div className="dali-cmp-stat__tools">
              <button
                type="button"
                className="dali-cmp-stat__tool dali-cmp-stat__del"
                aria-label={`Delete stat ${i + 1}`}
                title="Delete stat"
                onClick={() => {
                  setSel(null);
                  setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                }}
              >
                <Trash2 size={10} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            {sel === i && (
              <div className="dali-cmp-stat__colors" role="radiogroup" aria-label="Color">
                {TONES.map((t) => {
                  const on = (it.tone || "neutral") === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={t}
                      title={t}
                      onClick={() => setItem(i, { tone: t })}
                      className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${t}`}
                    >
                      {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="dali-cmp-stat dali-cmp-stat--add"
          onClick={() => {
            setSel(draft.items.length);
            setDraft((d) => ({ ...d, items: [...d.items, { value: "", label: "", tone: "neutral" }] }));
            setFocusNew(true);
          }}
        >
          <Plus className="dali-cmp-ico" size={11} strokeWidth={1.5} aria-hidden />
          Add stat
        </button>
      </div>

      <div className="dali-cmp-foot">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={() => onSave(draft)}>
          Done
        </button>
      </div>
    </div>
  );
}

