import { Check, Link2, Palette, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "~/components/ui/toast";
import { useOutsideDismiss } from "~/components/ui/floating";
import { TONES, type ComponentData } from "../kinds";
import { linkLabel } from "./LinksEditor";

export function CardsEditor({
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const toast = useToast();
  const titleRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusTitle, setFocusTitle] = useState(false);

  useOutsideDismiss(sel !== null, ".dali-cmp-card--edit", () => setSel(null));

  useEffect(() => {
    setPaletteOpen(false);
    setLinkOpen(false);
  }, [sel]);

  useEffect(() => {
    if (!focusTitle) return;
    titleRefs.current[draft.items.length - 1]?.focus();
    setFocusTitle(false);
  }, [focusTitle, draft.items.length]);

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
    <div className="dali-cmp-cards-edit">
      <input
        aria-label="Heading"
        value={draft.fields.title ?? ""}
        placeholder="Heading"
        onChange={(e) => setDraft((d) => ({ ...d, fields: { ...d.fields, title: e.target.value } }))}
        className="dali-cmp-title dali-cmp-bare"
      />
      <div className="dali-cmp-grid dali-cmp-grid--edit" onDragLeave={() => setDragOver(null)}>
        {draft.items.map((it, i) => (
          <div
            key={i}
            role="group"
            aria-label={`Card ${i + 1}. Alt plus arrow keys reorder.`}
            draggable
            className={`dali-cmp-card dali-cmp-card--edit${!it.title && !it.tag && !it.meta ? " dali-cmp-card--blank" : ""} dali-cmp-tone--${it.tone || "neutral"}${sel === i ? " dali-cmp-card--selected" : ""}${dragOver === i && dragFrom !== i ? " dali-cmp-card--over" : ""}${dragFrom === i ? " dali-cmp-card--dragging" : ""}`}
            onClick={() => setSel(i)}
            onFocusCapture={() => setSel(i)}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                const to = i + (e.key === "ArrowLeft" ? -1 : 1);
                move(i, to);
                requestAnimationFrame(() => titleRefs.current[to]?.focus());
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
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
          >
            <input
              aria-label={`Card ${i + 1} tag`}
              value={it.tag ?? ""}
              placeholder="Tag"
              size={Math.max((it.tag ?? "").length, 3)}
              onChange={(e) => setItem(i, { tag: e.target.value })}
              className="dali-cmp-tag dali-cmp-card__field dali-cmp-card__field--tag"
            />
            <input
              ref={(el) => {
                titleRefs.current[i] = el;
              }}
              aria-label={`Card ${i + 1} title`}
              value={it.title ?? ""}
              placeholder="Title"
              onChange={(e) => setItem(i, { title: e.target.value })}
              className="dali-cmp-card__title dali-cmp-card__field"
            />
            <input
              aria-label={`Card ${i + 1} detail`}
              value={it.meta ?? ""}
              placeholder="Detail"
              onChange={(e) => setItem(i, { meta: e.target.value })}
              className="dali-cmp-meta dali-cmp-card__field"
            />
            <div className="dali-cmp-card__tools">
              {sel === i && (
                <button
                  type="button"
                  className={`dali-cmp-card__tool${it.href ? " dali-cmp-card__tool--on" : ""}`}
                  aria-label={it.href ? `Edit link for card ${i + 1}` : `Add link to card ${i + 1}`}
                  title={it.href ? linkLabel(it.href) : "Add link"}
                  onClick={() => {
                    setPaletteOpen(false);
                    setLinkOpen((o) => !o);
                  }}
                >
                  <Link2 size={13} strokeWidth={1.5} aria-hidden />
                </button>
              )}
              {sel === i && (
                <button
                  type="button"
                  className="dali-cmp-card__tool"
                  aria-label={`Card ${i + 1} color`}
                  aria-expanded={paletteOpen}
                  title="Color"
                  onClick={() => {
                    setLinkOpen(false);
                    setPaletteOpen((o) => !o);
                  }}
                >
                  <Palette size={13} strokeWidth={1.5} aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="dali-cmp-card__tool dali-cmp-card__tool--del"
                aria-label={`Delete card ${i + 1}`}
                title="Delete card"
                onClick={() => {
                  setSel(null);
                  setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                  toast.error(<span className="font-medium text-destructive">Card deleted</span>, {
                    duration: 8000,
                    actions: [
                      {
                        label: "Undo",
                        onClick: () =>
                          setDraft((d) => {
                            const items = [...d.items];
                            items.splice(Math.min(i, items.length), 0, it);
                            return { ...d, items };
                          }),
                      },
                    ],
                  });
                }}
              >
                <Trash2 size={13} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            {sel === i && paletteOpen && (
              <div className="dali-cmp-card__palette" role="radiogroup" aria-label="Color">
                {TONES.map((tn) => {
                  const on = (it.tone || "neutral") === tn;
                  return (
                    <button
                      key={tn}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={tn}
                      title={tn}
                      onClick={() => {
                        setItem(i, { tone: tn });
                        setPaletteOpen(false);
                      }}
                      className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${tn}`}
                    >
                      {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            )}
            {sel === i && (linkOpen ? (
              <input
                autoFocus
                aria-label={`Card ${i + 1} link`}
                value={it.href ?? ""}
                placeholder="https://..."
                inputMode="url"
                onChange={(e) => setItem(i, { href: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setLinkOpen(false);
                  }
                }}
                onBlur={() => setLinkOpen(false)}
                className="dali-cmp-meta dali-cmp-card__field dali-cmp-card__link"
              />
            ) : null)}
          </div>
        ))}
        <button
          type="button"
          className="dali-cmp-card dali-cmp-card--add"
          onClick={() => {
            setSel(draft.items.length);
            setDraft((d) => ({ ...d, items: [...d.items, { tag: "", tone: ["accent", "success", "warning", "danger", "neutral"][d.items.length % 5]!, title: "", meta: "", href: "" }] }));
            setFocusTitle(true);
          }}
        >
          <Plus className="dali-cmp-ico" size={9} strokeWidth={1.5} aria-hidden />
          Add card
        </button>
      </div>

      <div className="dali-cmp-foot" aria-live="polite">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={() => onSave({ ...draft, items: draft.items.filter((it) => it.title?.trim() || it.tag?.trim() || it.meta?.trim()) })}>
          Done
        </button>
      </div>
    </div>
  );
}

