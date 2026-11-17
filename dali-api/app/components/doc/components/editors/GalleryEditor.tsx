import { Check, GripVertical, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "~/components/ui/toast";
import { useOutsideDismiss } from "~/components/ui/floating";
import { TONES, safeHref, type ComponentData } from "../kinds";
import { IMAGE_UPLOAD_ACCEPT, uploadEditorImage } from "../../upload";

export function GalleryEditor({
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
  const [subOpen, setSubOpen] = useState(!!draft.fields.subtitle);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [alignEnd, setAlignEnd] = useState(false);
  const [tab, setTab] = useState<"upload" | "link">("upload");
  const [focusNew, setFocusNew] = useState(false);
  const titleRefs = useRef<(HTMLInputElement | null)[]>([]);
  const popRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const setField = (key: string, value: string) => setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
  const setItem = (i: number, patch: Record<string, string>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const select = (i: number | null) => {
    setSel(i);
    setLinkError(null);
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
  const tryDone = () => {
    const bad = draft.items.findIndex((it) => (it.href ?? "").trim() && !safeHref(it.href));
    if (bad >= 0) {
      setSel(bad);
      setLinkError("Enter a valid link, like https://… or mailto:…");
      return;
    }
    onSave({ ...draft, items: draft.items.filter((it) => it.title?.trim() || it.image?.trim() || it.byline?.trim()) });
  };

  useEffect(() => {
    if (!focusNew) return;
    titleRefs.current[draft.items.length - 1]?.focus();
    setFocusNew(false);
  }, [focusNew, draft.items.length]);

  useOutsideDismiss(sel !== null, ".dali-cmp-piece--edit", () => select(null));

  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    setAlignEnd(false);
    requestAnimationFrame(() => {
      if (pop.getBoundingClientRect().right > window.innerWidth - 12) setAlignEnd(true);
    });
  }, [sel]);

  return (
    <div className="dali-cmp-gal-edit">
      <div className="dali-cmp-head">
        <input aria-label="Gallery title" value={draft.fields.title ?? ""} placeholder="Title" onChange={(e) => setField("title", e.target.value)} className="dali-cmp-title dali-cmp-bare" />
        {subOpen ? (
          <input aria-label="Subtitle" value={draft.fields.subtitle ?? ""} placeholder="Subtitle" autoFocus={!draft.fields.subtitle} onChange={(e) => setField("subtitle", e.target.value)} className="dali-cmp-sub dali-cmp-bare" />
        ) : (
          <button type="button" className="dali-cmp-mini dali-cmp-mini--flush self-start" onClick={() => setSubOpen(true)}>
            Add subtitle
          </button>
        )}
      </div>
      <div className="dali-cmp-foot">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={tryDone}>
          Done
        </button>
      </div>

      <div className="dali-cmp-grid dali-cmp-grid--edit">
        {draft.items.map((it, i) => (
          <div
            key={i}
            draggable={dragReady === i}
            className={`dali-cmp-piece dali-cmp-piece--edit dali-cmp-tone--${it.tone || "neutral"}${sel === i ? " dali-cmp-piece--selected" : ""}${dragFrom === i ? " dali-cmp-piece--dragging" : ""}`}
            onFocusCapture={() => sel !== i && select(i)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && sel === i) {
                e.stopPropagation();
                select(null);
              } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
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
              setDragReady(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragReady(null);
            }}
          >
            <button
              type="button"
              className="dali-cmp-piece__artbtn"
              aria-label={it.image ? `Change image for ${it.title || "piece"}` : `Add image for ${it.title || "piece"}`}
              disabled={uploading}
              onClick={() => {
                select(i);
                fileRef.current?.click();
              }}
            >
              {it.image ? <img className="dali-cmp-piece__art" src={it.image} alt="" /> : <span className="dali-cmp-piece__art" />}
              <span className="dali-cmp-piece__edithint" aria-hidden>
                <ImagePlus size={16} strokeWidth={1.5} />
              </span>
            </button>
            <button
              type="button"
              className="dali-cmp-piece__grip"
              aria-label={`Reorder ${it.title || "piece"}. Drag, or use the left and right arrow keys.`}
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
              <GripVertical size={14} strokeWidth={1.5} aria-hidden />
            </button>
            <input
              ref={(el) => {
                titleRefs.current[i] = el;
              }}
              aria-label={`Piece ${i + 1} title`}
              value={it.title ?? ""}
              placeholder="Title"
              onChange={(e) => setItem(i, { title: e.target.value })}
              className="dali-cmp-row__title dali-cmp-piece__titlefield"
            />
            <input
              aria-label={`Piece ${i + 1} credit`}
              value={it.byline ?? ""}
              placeholder="Credit"
              onChange={(e) => setItem(i, { byline: e.target.value })}
              className="dali-cmp-sub dali-cmp-piece__titlefield"
            />
            {sel === i && (
              <div ref={popRef} className={`dali-cmp-piece__pop${alignEnd ? " dali-cmp-piece__pop--end" : ""}`} role="dialog" aria-label={`Edit ${it.title || "piece"}`}>
                <div className="dali-cmp-piece__tabs" role="tablist" aria-label="Image source">
                  {(["upload", "link"] as const).map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                      {t === "upload" ? "Upload" : "Link"}
                    </button>
                  ))}
                </div>
                {tab === "upload" ? (
                  <div className="dali-cmp-piece__upload">
                    <button type="button" className="dali-cmp-piece__uploadbtn" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      <ImagePlus size={14} strokeWidth={1.5} aria-hidden />
                      {uploading ? "Uploading" : it.image ? "Replace image" : "Upload image"}
                    </button>
                    {it.image && (
                      <button type="button" className="dali-cmp-mini" onClick={() => setItem(i, { image: "" })}>
                        Remove image
                      </button>
                    )}
                  </div>
                ) : (
                  <input aria-label="Image link" value={it.image ?? ""} placeholder="Paste an image link" inputMode="url" onChange={(e) => setItem(i, { image: e.target.value })} />
                )}
                <label className="dali-cmp-pop-field">
                  <span>Opens</span>
                  <input value={it.href ?? ""} placeholder="https://..." inputMode="url" aria-invalid={!!linkError} onChange={(e) => { setLinkError(null); setItem(i, { href: e.target.value }); }} />
                </label>
                {linkError && (
                  <p role="alert" className="dali-cmp-pop-error">
                    {linkError}
                  </p>
                )}
                <div className="dali-cmp-pop-field">
                  <span>Color</span>
                  <div className="dali-cmp-chip-pop__colors" role="radiogroup" aria-label="Color">
                    {TONES.map((tn) => {
                      const on = (it.tone || "neutral") === tn;
                      return (
                        <button key={tn} type="button" role="radio" aria-checked={on} aria-label={tn} title={tn} onClick={() => setItem(i, { tone: tn })} className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${tn}`}>
                          {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="dali-cmp-pop-actions">
                  <button
                    type="button"
                    className="dali-cmp-pop-delete"
                    onClick={() => {
                      select(null);
                      setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                      toast.error(<span className="font-medium text-destructive">Piece deleted</span>, {
                        duration: 8000,
                        actions: [{ label: "Undo", onClick: () => setDraft((d) => { const items = [...d.items]; items.splice(Math.min(i, items.length), 0, it); return { ...d, items }; }) }],
                      });
                    }}
                  >
                    <Trash2 className="dali-cmp-ico" size={12} strokeWidth={1.5} aria-hidden />
                    Delete
                  </button>
                  <button type="button" className="dali-cmp-pop-save" onClick={() => select(null)}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          className="dali-cmp-piece dali-cmp-piece--add"
          onClick={() => {
            const cycle = ["accent", "success", "warning", "danger", "neutral"];
            setSel(draft.items.length);
            setDraft((d) => ({ ...d, items: [...d.items, { image: "", title: "", byline: "", tone: cycle[d.items.length % cycle.length]!, href: "" }] }));
            setFocusNew(true);
          }}
        >
          <span className="dali-cmp-piece__art">
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Add piece
          </span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || sel === null) return;
          const target = sel;
          setUploading(true);
          try {
            setItem(target, { image: await uploadEditorImage(file) });
          } catch {
            toast.error("Upload failed.");
          } finally {
            setUploading(false);
          }
        }}
      />
    </div>
  );
}

