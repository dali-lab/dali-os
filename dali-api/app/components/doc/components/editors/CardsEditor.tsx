import { GripVertical, Link2, Palette, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "~/components/ui/toast";
import { FormField } from "~/components/ui/FormField";
import { useOutsideDismiss } from "~/components/ui/floating";
import { safeHref, type ComponentData } from "../kinds";
import { EditPopover, PopoverError, ToneSwatches, useTriggerAnchor } from "./EditPopover";
import { linkLabel } from "./LinksEditor";
import { startItemDrag, reorderDirection, focusGrip } from "./reorder";

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
  const [linkError, setLinkError] = useState<string | null>(null);
  const { ref: toolRef, anchor } = useTriggerAnchor<HTMLButtonElement>(linkOpen ? "link" : paletteOpen ? "palette" : null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const toast = useToast();
  const gridRef = useRef<HTMLDivElement>(null);
  const titleRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusTitle, setFocusTitle] = useState(false);

  useOutsideDismiss(sel !== null && !linkOpen, ".dali-cmp-card--edit", () => setSel(null));

  useEffect(() => {
    setPaletteOpen(false);
    setLinkOpen(false);
    setLinkError(null);
  }, [sel]);

  useEffect(() => {
    if (!focusTitle) return;
    titleRefs.current[draft.items.length - 1]?.focus();
    setFocusTitle(false);
  }, [focusTitle, draft.items.length]);

  const setItem = (i: number, patch: Record<string, string>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const closeLink = (i: number) => {
    const href = (draft.items[i]!.href ?? "").trim();
    if (href && !safeHref(href)) return setLinkError("Enter a valid link, like https://… or mailto:…");
    setLinkOpen(false);
  };

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
      <div ref={gridRef} className="dali-cmp-grid dali-cmp-grid--edit" onDragLeave={() => setDragOver(null)}>
        {draft.items.map((it, i) => (
          <div
            key={i}
            role="group"
            aria-label={`Card ${i + 1}. Alt plus arrow keys reorder.`}
            draggable={dragReady === i}
            className={`dali-cmp-card dali-cmp-card--edit${!it.title && !it.tag && !it.meta ? " dali-cmp-card--blank" : ""} dali-cmp-tone--${it.tone || "neutral"}${sel === i ? " dali-cmp-card--selected" : ""}${dragOver === i && dragFrom !== i ? " dali-cmp-card--over" : ""}${dragFrom === i ? " dali-cmp-card--dragging" : ""}`}
            onClick={() => setSel(i)}
            onFocusCapture={() => setSel(i)}
            onKeyDown={(e) => {
              const dir = reorderDirection(e, ["ArrowLeft", "ArrowRight"]);
              if (dir) {
                e.preventDefault();
                move(i, i + dir);
                focusGrip(gridRef.current, i + dir);
              }
            }}
            onDragStart={(e) => {
              startItemDrag(e, i);
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
              setDragReady(null);
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
              <button
                type="button"
                data-reorder-grip
                className="dali-cmp-card__tool dali-cmp-card__grip"
                aria-label={`Reorder card ${i + 1}. Drag, or use Alt plus the left and right arrow keys.`}
                onMouseDown={() => setDragReady(i)}
                onMouseUp={() => setDragReady(null)}
              >
                <GripVertical size={13} strokeWidth={1.5} aria-hidden />
              </button>
              {sel === i && (
                <button
                  type="button"
                  className={`dali-cmp-card__tool${it.href ? " dali-cmp-card__tool--on" : ""}`}
                  aria-label={it.href ? `Edit link for card ${i + 1}` : `Add link to card ${i + 1}`}
                  title={it.href ? linkLabel(it.href) : "Add link"}
                  ref={linkOpen ? toolRef : undefined}
                  aria-expanded={linkOpen}
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
                  ref={paletteOpen ? toolRef : undefined}
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
                onClick={(e) => {
                  e.stopPropagation();
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
              <EditPopover compact anchor={anchor} excludeRef={toolRef} ariaLabel={`Card ${i + 1} color`} onClose={() => setPaletteOpen(false)}>
                <ToneSwatches
                  label="Color"
                  value={it.tone || "neutral"}
                  onPick={(tn) => {
                    setItem(i, { tone: tn });
                    setPaletteOpen(false);
                  }}
                />
              </EditPopover>
            )}
            {sel === i && linkOpen && (
              <EditPopover anchor={anchor} excludeRef={toolRef} ariaLabel={`Card ${i + 1} link`} onClose={() => closeLink(i)}>
                <FormField
                  label="Link"
                  autoFocus
                  type="url"
                  inputMode="url"
                  value={it.href ?? ""}
                  placeholder="https://..."
                  invalid={!!linkError}
                  onChange={(v) => {
                    setLinkError(null);
                    setItem(i, { href: v });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      closeLink(i);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setLinkOpen(false);
                      setLinkError(null);
                    }
                  }}
                />
                {linkError && <PopoverError>{linkError}</PopoverError>}
              </EditPopover>
            )}
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

