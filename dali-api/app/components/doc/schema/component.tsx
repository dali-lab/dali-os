// The `component` block (React spec over the shared componentConfig): one node
// type for the whole component library — see ../components/kinds.ts. The block
// renders its kind's view; in an editable editor it adds an Edit button that
// opens one generic form built from the kind's field definitions.

import { createReactBlockSpec } from "@blocknote/react";
import { ArrowDown, ArrowUp, Check, Columns2, Flag, GripVertical, ImagePlus, Link2, Palette, Pencil, Rows2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import {
  TONES,
  safeHref,
  collectionCategories,
  kindDef,
  parseComponentData,
  type ComponentData,
  type FieldDef,
  type KindDef,
} from "../components/kinds";
import { ComponentView } from "../components/views";
import { COLLECTION_ICONS, CollectionTileBody } from "../components/CollectionView";
import { ChevronDown } from "lucide-react";
import { IMAGE_UPLOAD_ACCEPT, uploadEditorImage } from "../upload";
import { componentConfig } from "./configs";

function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  if (def.type === "tone") {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="os-field-label">{def.label}</span>
        <div className="flex gap-1.5" role="radiogroup" aria-label={def.label}>
          {TONES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={value === t}
              aria-label={t}
              onClick={() => onChange(t)}
              className={`dali-cmp-swatch dali-cmp-tone--${t}`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span>{def.label}</span>
      {def.type === "textarea" || def.type === "code" ? (
        <textarea
          rows={def.type === "code" ? 16 : 3}
          value={value}
          placeholder={def.placeholder}
          spellCheck={def.type !== "code"}
          onChange={(e) => onChange(e.target.value)}
          className={def.type === "code" ? "font-mono text-xs" : undefined}
        />
      ) : (
        <span className="flex items-center gap-1">
          <input
            type="text"
            value={value}
            placeholder={def.type === "image" ? "Image link" : def.placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="min-w-0 flex-1"
          />
          {def.type === "image" && (
            <>
              <IconButton
                label="Upload image"
                icon={ImagePlus}
                onClick={() => fileRef.current?.click()}
              />
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_UPLOAD_ACCEPT}
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onChange(await uploadEditorImage(file));
                }}
              />
            </>
          )}
        </span>
      )}
    </label>
  );
}

function TimelineEditor({
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
  const [fanOpen, setFanOpen] = useState<number | null>(null);
  const [fanPin, setFanPin] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const [noteOpen, setNoteOpen] = useState(!!draft.fields.note);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusLast, setFocusLast] = useState(false);

  const dialog = useDialog();
  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
  const setItem = (i: number, patch: Record<string, string>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const current = Number.parseInt(draft.fields.current ?? "", 10);

  useEffect(() => {
    if (fanPin === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-step__numwrap, [class*=\"devstudio\"]")) {
        setFanPin(null);
        setFanOpen(null);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFanPin(null);
        setFanOpen(null);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [fanPin]);

  const closeFan = () => {
    setFanPin(null);
    setFanOpen(null);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length || from === to) return;
    setDraft((d) => {
      const items = [...d.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it!);
      return { ...d, items };
    });
    closeFan();
  };

  useEffect(() => {
    if (!focusLast) return;
    nameRefs.current[draft.items.length - 1]?.focus();
    setFocusLast(false);
  }, [focusLast, draft.items.length]);

  return (
    <div className="dali-cmp-panel dali-cmp-timeline-edit">
      <div className="dali-cmp-head dali-cmp-head--edit">
        <input
          aria-label="Timeline title"
          value={draft.fields.title ?? ""}
          placeholder="Title"
          onChange={(e) => setField("title", e.target.value)}
          className="dali-cmp-title dali-cmp-bare"
        />
        {noteOpen ? (
          <input
            aria-label="Note"
            value={draft.fields.note ?? ""}
            placeholder="Subtitle"
            autoFocus={!draft.fields.note}
            onChange={(e) => setField("note", e.target.value)}
            className="dali-cmp-sub dali-cmp-bare"
          />
        ) : (
          <button type="button" className="dali-cmp-mini dali-cmp-mini--flush" onClick={() => setNoteOpen(true)}>
            Add subtitle
          </button>
        )}
      </div>

      <ol className="dali-cmp-steps dali-cmp-steps--edit">
        {draft.items.map((it, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "next";
          return (
            <li
              key={i}
              draggable={dragReady === i}
              className={`dali-cmp-step dali-cmp-step--${state}${it.tone ? ` dali-cmp-step--toned dali-cmp-tone--${it.tone}` : ""}${dragFrom === i ? " dali-cmp-step--dragging" : ""}`}
              onKeyDown={(e) => {
                if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                  e.preventDefault();
                  const to = i + (e.key === "ArrowLeft" ? -1 : 1);
                  move(i, to);
                  requestAnimationFrame(() => nameRefs.current[to]?.focus());
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
              <div
                className="dali-cmp-step__numwrap"
                onMouseEnter={() => {
                  setFanPin(i);
                  setFanOpen(i);
                }}
              >
                <button
                  type="button"
                  className="dali-cmp-step__num dali-cmp-step__num--btn"
                  title="Color and current step"
                  aria-label={`Step ${n} options`}
                  aria-expanded={fanOpen === i}
                  onMouseDown={() => setDragReady(i)}
                  onMouseUp={() => setDragReady(null)}
                  onClick={() => {
                    if (fanPin === i) return closeFan();
                    setFanPin(i);
                    setFanOpen(i);
                  }}
                >
                  {n}
                </button>
                {fanOpen === i && (
                  <div className="dali-cmp-fan" role="group" aria-label={`Step ${n} color`}>
                    {TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        aria-label={t}
                        aria-pressed={it.tone === t}
                        title={it.tone === t ? `${t} (click to clear)` : t}
                        className={`dali-cmp-swatch dali-cmp-tone--${t}`}
                        onClick={() => {
                          setItem(i, { tone: it.tone === t ? "" : t });
                          closeFan();
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      className="dali-cmp-fan__current"
                      aria-label={`Make step ${n} the current step`}
                      title="Make current step"
                      onClick={() => {
                        setField("current", String(n));
                        closeFan();
                      }}
                    >
                      <Flag size={10} strokeWidth={1.75} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              <div className="dali-cmp-step__namewrap">
                <input
                  ref={(el) => {
                    nameRefs.current[i] = el;
                  }}
                  aria-label={`Step ${n} name`}
                  value={it.label ?? ""}
                  placeholder="Name"
                  onChange={(e) => setItem(i, { label: e.target.value })}
                  className="dali-cmp-step__input"
                />
                <button
                  type="button"
                  className="dali-cmp-step__del"
                  aria-label={`Delete step ${n}`}
                  title="Delete step"
                  onClick={async () => {
                    setFanOpen(null);
                    const ok = await dialog.confirm({
                      title: "Delete this step?",
                      description: it.label ? `Step ${n}, “${it.label}”, will be removed.` : `Step ${n} will be removed.`,
                      confirmLabel: "Delete",
                      tone: "destructive",
                    });
                    if (ok) setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                    requestAnimationFrame(() => nameRefs.current[ok ? Math.min(i, draft.items.length - 2) : i]?.focus());
                  }}
                >
                  <Trash2 className="dali-cmp-ico" size={12} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
              <textarea
                rows={1}
                aria-label={`Step ${n} details`}
                value={it.details ?? ""}
                placeholder="Add details"
                onChange={(e) => setItem(i, { details: e.target.value })}
                className="dali-cmp-step__details"
              />
            </li>
          );
        })}
        <li className="dali-cmp-step dali-cmp-step--add">
          <button
            type="button"
            className="dali-cmp-step__addbtn"
            aria-label="Add step"
            onClick={() => {
              setDraft((d) => ({ ...d, items: [...d.items, { label: "" }] }));
              setFocusLast(true);
            }}
          >
            <span className="dali-cmp-step__addcircle">
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden>
                <path d="M5 0.5v9M0.5 5h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
              </svg>
            </span>
            <span className="dali-cmp-step__label">Add step</span>
          </button>
        </li>
      </ol>

      <div className="dali-cmp-foot">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={() => onSave({ ...draft, items: draft.items.filter((it) => (it.label ?? "").trim() || (it.details ?? "").trim()) })}>
          Done
        </button>
      </div>
    </div>
  );
}

function ChipsEditor({
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
  const toast = useToast();
  const [urlOpen, setUrlOpen] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<ComponentData["items"][number] | null>(null);
  const [popError, setPopError] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const inline = draft.fields.layout === "inline";

  useEffect(() => {
    if (urlOpen === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-chip--edit, [class*=\"devstudio\"]")) openPop(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [urlOpen]);

  const setItem = (i: number, patch: Record<string, string>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const openPop = (i: number | null, item?: ComponentData["items"][number]) => {
    setUrlOpen(i);
    setSnapshot(i === null ? null : { ...(item ?? draft.items[i]!) });
    setPopError(null);
  };
  const validate = (it: ComponentData["items"][number]) => {
    if (!(it.label ?? "").trim()) return "Add a name.";
    const href = (it.href ?? "").trim();
    if (href && !safeHref(href)) return "Enter a valid link, like https://… or mailto:…";
    return null;
  };
  const savePop = (i: number) => {
    const err = validate(draft.items[i]!);
    if (err) return setPopError(err);
    openPop(null);
  };
  const cancelPop = (i: number) => {
    if (snapshot && !(snapshot.label ?? "").trim() && !(snapshot.href ?? "").trim()) {
      setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
    } else if (snapshot) {
      setItem(i, { label: snapshot.label ?? "", href: snapshot.href ?? "" });
    }
    openPop(null);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length || from === to) return;
    setDraft((d) => {
      const items = [...d.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it!);
      return { ...d, items };
    });
    setUrlOpen((o) => (o === null ? o : o === from ? to : from < to && o > from && o <= to ? o - 1 : to <= o && o < from ? o + 1 : o));
      };

  // Same structure and classes as the rendered component, so editing happens
  // where the pills already sit; the only extras are quiet, per-pill controls.
  return (
    <div className="dali-cmp-chips-edit">
      <div className={`dali-cmp-chips${inline ? "" : " dali-cmp-chips--stacked"}`}>
        <input
          aria-label="Section label"
          value={draft.fields.label ?? ""}
          placeholder="Title"
          onChange={(e) => setDraft((d) => ({ ...d, fields: { ...d.fields, label: e.target.value } }))}
          className="dali-cmp-eyebrow dali-cmp-chips-edit__label"
        />
        <ul className="dali-cmp-chips__row" onDragLeave={() => setDragOver(null)}>
          {draft.items.map((it, i) => (
            <li
              key={i}
              className={`dali-cmp-chip dali-cmp-chip--edit${it.tone ? ` dali-cmp-tone--${it.tone}` : ""}${dragOver === i && dragFrom !== i ? " dali-cmp-chip--over" : ""}${dragFrom === i ? " dali-cmp-chip--dragging" : ""}`}
              draggable={urlOpen !== i}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", String(i));
                setDragFrom(i);
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
            >
              <button
                type="button"
                className="dali-cmp-chip__btn"
                aria-label={`Edit ${it.label || "link"}. Arrow keys reorder.`}
                aria-expanded={urlOpen === i}
                onClick={() => (urlOpen === i ? openPop(null) : openPop(i))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault();
                    move(i, i + (e.key === "ArrowLeft" ? -1 : 1));
                  }
                }}
              >
                {it.label || <span className="opacity-50">Link</span>}
              </button>
              {urlOpen === i && (
                <div
                  className="dali-cmp-chip-pop"
                  role="dialog"
                  aria-label={`Edit ${it.label || "link"}`}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      cancelPop(i);
                    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                      e.preventDefault();
                      savePop(i);
                    }
                  }}
                >
                  <label className="dali-cmp-pop-field">
                    <span>Name</span>
                    <input
                      autoFocus
                      value={it.label ?? ""}
                      placeholder="Link name"
                      aria-invalid={popError === "Add a name."}
                      onChange={(e) => {
                        setPopError(null);
                        setItem(i, { label: e.target.value });
                      }}
                    />
                  </label>
                  <label className="dali-cmp-pop-field">
                    <span>Link</span>
                    <input
                      value={it.href ?? ""}
                      placeholder="https://"
                      inputMode="url"
                      aria-invalid={!!popError && popError !== "Add a name."}
                      onChange={(e) => {
                        setPopError(null);
                        setItem(i, { href: e.target.value });
                      }}
                    />
                  </label>
                  <div className="dali-cmp-pop-field">
                    <span>Color</span>
                    <div className="dali-cmp-chip-pop__colors" role="radiogroup" aria-label="Link color">
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
                            onClick={() => setItem(i, { tone: tn })}
                            className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${tn}`}
                          >
                            {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {popError && (
                    <p role="alert" className="dali-cmp-pop-error">
                      {popError}
                    </p>
                  )}
                  <div className="dali-cmp-pop-actions">
                    <button
                      type="button"
                      className="dali-cmp-pop-delete"
                      onClick={() => {
                        openPop(null);
                        setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                      }}
                    >
                      <Trash2 className="dali-cmp-ico" size={7} strokeWidth={1.5} aria-hidden />
                      Delete
                    </button>
                    <button type="button" className="dali-cmp-pop-save" onClick={() => savePop(i)}>
                      Save
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {urlOpen === null && <li>
            <button
              type="button"
              className="dali-cmp-chip dali-cmp-chip--add"
              onClick={() => {
                openPop(draft.items.length, { label: "", href: "" });
                setDraft((d) => ({ ...d, items: [...d.items, { label: "", href: "" }] }));
              }}
            >
              <Plus className="dali-cmp-ico" size={9} strokeWidth={1.5} aria-hidden />
              Add link
            </button>
          </li>}
        </ul>
      </div>

      <div className="dali-cmp-chips-edit__foot">
        <div className="dali-cmp-toggle" role="radiogroup" aria-label="Label position">
          <button
            type="button"
            role="radio"
            aria-checked={!inline}
            aria-label="Label above"
            title="Label above"
            onClick={() => setDraft((d) => ({ ...d, fields: { ...d.fields, layout: "stacked" } }))}
          >
            <Rows2 size={15} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={inline}
            aria-label="Label inline"
            title="Label inline"
            onClick={() => setDraft((d) => ({ ...d, fields: { ...d.fields, layout: "inline" } }))}
          >
            <Columns2 size={15} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>
      <div className="dali-cmp-foot">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={() => onSave({ ...draft, items: draft.items.filter((it) => (it.label ?? "").trim()) })}>
          Done
        </button>
      </div>
    </div>
  );
}

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

  useEffect(() => {
    if (sel === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-card--edit, [class*=\"devstudio\"]")) setSel(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sel]);

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

function StatsEditor({
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

  useEffect(() => {
    if (sel === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-stat--edit, [class*=\"devstudio\"]")) setSel(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sel]);

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

export function linkLabel(href: string): string {
  const raw = href.trim();
  if (!raw) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "") || raw;
  } catch {
    return raw;
  }
}

type ResourceFields = { title: string; description: string; meta: string; href: string; image: string; tone: string };
const EMPTY_RESOURCE: ResourceFields = { title: "", description: "", meta: "", href: "", image: "", tone: "" };

function ResourceThumb({ image, tone }: { image?: string; tone?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`dali-cmp-row__thumb dali-cmp-tone--${tone || "accent"}`} aria-hidden>
      {image && !broken && <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
    </span>
  );
}

function ResourceForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ResourceFields;
  submitLabel: string;
  onSubmit: (fields: ResourceFields) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const detailOpen = !!initial.meta;
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<"idle" | "loading" | "found" | "none">("idle");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const looked = useRef(initial.href.trim());
  const imageTouched = useRef(!!initial.image);
  const set = (patch: Partial<ResourceFields>) => {
    setError(null);
    setF((c) => ({ ...c, ...patch }));
  };
  const canSubmit = f.title.trim().length > 0 && f.href.trim().length > 0 && !uploading;

  const findPreview = async () => {
    const href = safeHref(f.href);
    if (!href || href === looked.current || !/^https?:/i.test(href)) return;
    looked.current = href;
    setLookup("loading");
    try {
      const body = new FormData();
      body.set("url", href);
      const res = await fetch("/api/link-preview", { method: "POST", body });
      const data = (await res.json()) as { image: string | null; title: string | null; description: string | null };
      setF((c) => ({
        ...c,
        image: !imageTouched.current && data.image ? data.image : c.image,
        title: c.title.trim() ? c.title : (data.title ?? "").slice(0, 120),
        description: c.description.trim() ? c.description : (data.description ?? "").slice(0, 200),
      }));
      setLookup(data.image ? "found" : "none");
    } catch {
      setLookup("none");
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    const href = f.href.trim();
    if (!safeHref(href)) return setError("Enter a valid link, like https://… or mailto:…");
    onSubmit({ ...f, title: f.title.trim(), description: f.description.trim(), meta: f.meta.trim(), href });
  };

  return (
    <div
      className="dali-cmp-rowform"
      role="group"
      aria-label={submitLabel === "Add resource" ? "New resource" : "Edit resource"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="dali-cmp-rowform__body">
      <div className="dali-cmp-rowform__fields">
      <label className="dali-cmp-pop-field">
        <span>Link</span>
        <input
          autoFocus
          value={f.href}
          placeholder="https://..."
          inputMode="url"
          aria-invalid={!!error}
          onChange={(e) => set({ href: e.target.value })}
          onBlur={() => void findPreview()}
        />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Resource name</span>
        <input value={f.title} placeholder="e.g. Getting started guide" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Description <em>Optional</em></span>
        <input value={f.description} placeholder="What is this resource for?" onChange={(e) => set({ description: e.target.value })} />
      </label>
      {detailOpen && (
        <label className="dali-cmp-pop-field">
          <span>Detail <em>Optional</em></span>
          <input value={f.meta} placeholder="e.g. PDF, 12 pages" onChange={(e) => set({ meta: e.target.value })} />
        </label>
      )}
      </div>
      <div className="dali-cmp-rowform__media">
        <ResourceThumb image={f.image} tone={f.tone} />
        <div className="dali-cmp-rowform__mediactl">
          <div className="dali-cmp-rowform__mediabtns">
            <button type="button" className="dali-cmp-mini" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={12} strokeWidth={1.5} aria-hidden />
              {uploading ? "Uploading" : f.image ? "Change image" : "Upload image"}
            </button>
            {f.image && (
              <button
                type="button"
                className="dali-cmp-mini"
                onClick={() => {
                  imageTouched.current = true;
                  set({ image: "" });
                }}
              >
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_UPLOAD_ACCEPT}
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setUploading(true);
                try {
                  imageTouched.current = true;
                  set({ image: await uploadEditorImage(file) });
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
          <div className="dali-cmp-chip-pop__colors" role="radiogroup" aria-label="Color">
            {TONES.map((tn) => {
              const on = (f.tone || "accent") === tn;
              return (
                <button
                  key={tn}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={tn}
                  title={tn}
                  onClick={() => set({ tone: tn })}
                  className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${tn}`}
                >
                  {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
                </button>
              );
            })}
          </div>
          <p className="dali-cmp-rowform__hint" aria-live="polite">
            {lookup === "loading"
              ? "Looking for an image…"
              : lookup === "found"
                ? "Image found from the link."
                : ""}
          </p>
        </div>
      </div>
      </div>
      {error && (
        <p role="alert" className="dali-cmp-pop-error">
          {error}
        </p>
      )}
      <div className="dali-cmp-rowform__actions">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm" disabled={!canSubmit} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function LinksEditor({
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
  const [subOpen, setSubOpen] = useState(!!draft.fields.subtitle);
  const [form, setForm] = useState<number | "new" | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const toast = useToast();
  const [needLink, setNeedLink] = useState(false);
  const missingLink = draft.items.findIndex((it) => !(it.href ?? "").trim());
  const addRef = useRef<HTMLButtonElement | null>(null);
  const openRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
  const closeForm = (focusIndex?: number) => {
    setForm(null);
    requestAnimationFrame(() => (focusIndex === undefined ? addRef.current : openRefs.current[focusIndex])?.focus());
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length || from === to) return;
    setForm(null);
    setDraft((d) => {
      const items = [...d.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it!);
      return { ...d, items };
    });
  };

  return (
    <div className="dali-cmp-panel dali-cmp-panel--flush dali-cmp-links-edit">
      <div className="dali-cmp-head">
        <input
          aria-label="Section title"
          value={draft.fields.title ?? ""}
          placeholder="Title"
          onChange={(e) => setField("title", e.target.value)}
          className="dali-cmp-title dali-cmp-bare"
        />
        {subOpen ? (
          <input
            aria-label="Subtitle"
            value={draft.fields.subtitle ?? ""}
            placeholder="Subtitle"
            autoFocus={!draft.fields.subtitle}
            onChange={(e) => setField("subtitle", e.target.value)}
            className="dali-cmp-sub dali-cmp-bare"
          />
        ) : (
          <button type="button" className="dali-cmp-mini dali-cmp-mini--flush self-start" onClick={() => setSubOpen(true)}>
            Add subtitle
          </button>
        )}
      </div>

      {draft.items.map((it, i) =>
        form === i ? (
          <ResourceForm
            key={i}
            initial={{ title: it.title ?? "", description: it.description ?? "", meta: it.meta ?? "", href: it.href ?? "", image: it.image ?? "", tone: it.tone ?? "" }}
            submitLabel="Save"
            onCancel={() => closeForm(i)}
            onSubmit={(f) => {
              setDraft((d) => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...f } : x)) }));
              closeForm(i);
            }}
          />
        ) : (
          <div
            key={i}
            draggable={dragReady === i}
            className={`dali-cmp-row dali-cmp-row--edit${dragFrom === i ? " dali-cmp-row--dragging" : ""}`}
            onKeyDown={(e) => {
              if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                e.preventDefault();
                const to = i + (e.key === "ArrowUp" ? -1 : 1);
                move(i, to);
                requestAnimationFrame(() => openRefs.current[to]?.focus());
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
              className="dali-cmp-row__tool dali-cmp-row__grip"
              aria-label={`Reorder ${it.title || "resource"}. Drag, or use Alt plus the up and down arrow keys.`}
              onMouseDown={() => setDragReady(i)}
              onMouseUp={() => setDragReady(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  e.stopPropagation();
                  move(i, i + (e.key === "ArrowUp" ? -1 : 1));
                }
              }}
            >
              <GripVertical size={16} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              ref={(el) => {
                openRefs.current[i] = el;
              }}
              className="dali-cmp-row__main dali-cmp-row__open"
              aria-label={`Edit ${it.title || "resource"}`}
              onClick={() => setForm(i)}
            >
              <ResourceThumb image={it.image} tone={it.tone} />
              <span className="dali-cmp-row__text">
                <span className="dali-cmp-row__title">{it.title || "Untitled resource"}</span>
                {it.description && <span className="dali-cmp-sub">{it.description}</span>}
                {it.href ? (
                  <span className="dali-cmp-row__linkind">
                    <Link2 size={12} strokeWidth={1.5} aria-hidden />
                    {linkLabel(it.href)}
                  </span>
                ) : (
                  <span className="dali-cmp-row__linkind dali-cmp-row__linkind--missing">Link required</span>
                )}
              </span>
            </button>
            <div className="dali-cmp-row__tools">
              <button type="button" className="dali-cmp-row__tool" aria-label={`Edit ${it.title || "resource"}`} title="Edit" onClick={() => setForm(i)}>
                <Pencil size={16} strokeWidth={1.5} aria-hidden />
              </button>
              <button
                type="button"
                className="dali-cmp-row__tool dali-cmp-row__tool--del"
                aria-label={`Delete ${it.title || "resource"}`}
                title="Delete"
                onClick={() => {
                  setForm(null);
                  setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                  toast.error(<span className="font-medium text-destructive">Resource deleted</span>, {
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
                <Trash2 size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          </div>
        ),
      )}

      {form === "new" && (
        <ResourceForm
          initial={EMPTY_RESOURCE}
          submitLabel="Add resource"
          onCancel={() => closeForm()}
          onSubmit={(f) => {
            setDraft((d) => ({ ...d, items: [...d.items, f] }));
            closeForm();
          }}
        />
      )}

      {form === null && (
        <button ref={addRef} type="button" className="dali-cmp-row dali-cmp-row--add" onClick={() => setForm("new")}>
          <Plus size={12} strokeWidth={1.5} aria-hidden />
          Add resource
        </button>
      )}

      <div className="dali-cmp-foot" aria-live="polite">
        {needLink && missingLink >= 0 && (
          <span role="alert" className="dali-cmp-pop-error">
            Every resource needs a link.
          </span>
        )}
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="os-btn-primary os-btn-primary--sm dali-cmp-done"
          onClick={() => {
            if (missingLink >= 0) {
              setNeedLink(true);
              setForm(missingLink);
              return;
            }
            onSave(draft);
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

type CollectionFields = { title: string; description: string; category: string; icon: string; href: string };
const EMPTY_TILE: CollectionFields = { title: "", description: "", category: "", icon: "link", href: "" };

function CollectionForm({
  initial,
  categories,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: CollectionFields;
  categories: string[];
  submitLabel: string;
  onSubmit: (fields: CollectionFields) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const looked = useRef(initial.href.trim());
  const set = (patch: Partial<CollectionFields>) => {
    setError(null);
    setF((c) => ({ ...c, ...patch }));
  };
  const canSubmit = f.title.trim().length > 0 && f.href.trim().length > 0;

  const findPreview = async () => {
    const href = safeHref(f.href);
    if (!href || href === looked.current || !/^https?:/i.test(href)) return;
    looked.current = href;
    try {
      const body = new FormData();
      body.set("url", href);
      const res = await fetch("/api/link-preview", { method: "POST", body });
      const data = (await res.json()) as { title: string | null; description: string | null };
      setF((c) => ({
        ...c,
        title: c.title.trim() ? c.title : (data.title ?? "").slice(0, 120),
        description: c.description.trim() ? c.description : (data.description ?? "").slice(0, 140),
      }));
    } catch {
      /* the link still works without a preview */
    }
  };
  const submit = () => {
    if (!canSubmit) return;
    const href = f.href.trim();
    if (!safeHref(href)) return setError("Enter a valid link, like https://… or a path starting with /");
    onSubmit({ ...f, title: f.title.trim(), description: f.description.trim(), category: f.category.replace(/,/g, " ").trim(), href });
  };

  return (
    <div
      className="dali-cmp-rowform dali-cmp-coll__form"
      role="group"
      aria-label={submitLabel === "Add resource" ? "New resource" : "Edit resource"}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <label className="dali-cmp-pop-field">
        <span>Link</span>
        <input autoFocus value={f.href} placeholder="https://..." inputMode="url" aria-invalid={!!error} onChange={(e) => set({ href: e.target.value })} onBlur={() => void findPreview()} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Resource name</span>
        <input value={f.title} placeholder="e.g. Figma" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Description <em>Optional</em></span>
        <input value={f.description} placeholder="What is this for?" onChange={(e) => set({ description: e.target.value })} />
      </label>
      <label className="dali-cmp-pop-field">
        <span>Category <em>Optional</em></span>
        <input value={f.category} list="dali-coll-cats" placeholder="Pick or type a new one" onChange={(e) => set({ category: e.target.value })} />
        <datalist id="dali-coll-cats">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <div className="dali-cmp-pop-field">
        <span>Icon</span>
        <div className="dali-cmp-coll__icons" role="radiogroup" aria-label="Icon">
          {Object.entries(COLLECTION_ICONS).map(([id, { label, Icon }]) => (
            <button key={id} type="button" role="radio" aria-checked={f.icon === id} aria-label={label} title={label} onClick={() => set({ icon: id })} className="dali-cmp-coll__iconbtn">
              <Icon size={16} strokeWidth={1.75} aria-hidden />
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="dali-cmp-pop-error">
          {error}
        </p>
      )}
      <div className="dali-cmp-rowform__actions">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm" disabled={!canSubmit} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function CollectionEditor({
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
  const [form, setForm] = useState<number | "new" | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [newCat, setNewCat] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const toast = useToast();
  const categories = collectionCategories(draft.fields, draft.items);
  const startsOpen = draft.fields.open !== "0";
  const setField = (patch: Record<string, string>) => setDraft((d) => ({ ...d, fields: { ...d.fields, ...patch } }));
  const setCategories = (list: string[]) => setField({ categories: list.join(", ") });
  const addCategory = () => {
    const v = newCat.replace(/,/g, " ").trim();
    if (v && !categories.some((c) => c.toLowerCase() === v.toLowerCase())) setCategories([...categories, v]);
    setNewCat("");
  };
  const removeCategory = (c: string) => {
    setCategories(categories.filter((x) => x !== c));
    setDraft((d) => ({ ...d, items: d.items.map((it) => ((it.category ?? "").toLowerCase() === c.toLowerCase() ? { ...it, category: "" } : it)) }));
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.items.length || from === to) return;
    setForm(null);
    setDraft((d) => {
      const items = [...d.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it!);
      return { ...d, items };
    });
  };
  const withCategory = (category: string) => {
    if (category && !categories.some((c) => c.toLowerCase() === category.toLowerCase())) setCategories([...categories, category]);
  };

  return (
    <div className="dali-cmp-coll dali-cmp-coll--edit dali-cmp-coll--open">
      <div className="dali-cmp-coll__headedit">
        <input aria-label="Section title" value={draft.fields.title ?? ""} placeholder="Title" onChange={(e) => setField({ title: e.target.value })} className="dali-cmp-title dali-cmp-bare" />
        <button type="button" className="dali-cmp-coll__chevbtn" aria-expanded={expanded} aria-label={expanded ? "Preview collapsed" : "Preview expanded"} title={expanded ? "Preview collapsed" : "Preview expanded"} onClick={() => setExpanded((x) => !x)}>
          <ChevronDown className="dali-cmp-coll__chev" size={18} strokeWidth={1.75} aria-hidden />
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

      <div className="dali-cmp-coll__meta">
        <div className="dali-cmp-coll__filters" role="group" aria-label="Categories">
          {categories.map((c) => (
            <span key={c} className="dali-cmp-coll__chip dali-cmp-coll__chip--edit">
              {c}
              <button type="button" aria-label={`Remove category ${c}`} title="Remove category" onClick={() => removeCategory(c)}>
                <X size={11} strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
          <input
            aria-label="New category"
            value={newCat}
            placeholder="+ Category"
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCategory();
              }
            }}
            onBlur={addCategory}
            className="dali-cmp-coll__newcat"
          />
        </div>
        <button type="button" role="switch" aria-checked={!startsOpen} className="dali-cmp-mini dali-cmp-coll__switch" onClick={() => setField({ open: startsOpen ? "0" : "1" })}>
          {startsOpen ? "Starts open" : "Starts collapsed"}
        </button>
      </div>

      <div className={`dali-cmp-coll__body${expanded ? "" : " dali-cmp-coll__body--shut"}`} inert={!expanded}>
        <div className="dali-cmp-coll__inner">
          <div className="dali-cmp-coll__grid">
            {draft.items.map((it, i) =>
              form === i ? (
                <CollectionForm
                  key={i}
                  initial={{ title: it.title ?? "", description: it.description ?? "", category: it.category ?? "", icon: it.icon || "link", href: it.href ?? "" }}
                  categories={categories}
                  submitLabel="Save"
                  onCancel={() => setForm(null)}
                  onSubmit={(f) => {
                    withCategory(f.category);
                    setDraft((d) => ({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...f } : x)) }));
                    setForm(null);
                  }}
                />
              ) : (
                <div
                  key={i}
                  draggable={dragReady === i}
                  className={`dali-cmp-coll__tile dali-cmp-coll__tile--edit${dragFrom === i ? " dali-cmp-coll__tile--dragging" : ""}`}
                  onKeyDown={(e) => {
                    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                      e.preventDefault();
                      move(i, i + (e.key === "ArrowLeft" ? -1 : 1));
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
                  <button type="button" className="dali-cmp-row__tool dali-cmp-coll__grip" aria-label={`Reorder ${it.title || "resource"}. Drag, or use Alt plus the left and right arrow keys.`} onMouseDown={() => setDragReady(i)} onMouseUp={() => setDragReady(null)} onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      e.stopPropagation();
                      move(i, i + (e.key === "ArrowLeft" ? -1 : 1));
                    }
                  }}>
                    <GripVertical size={14} strokeWidth={1.5} aria-hidden />
                  </button>
                  <button type="button" className="dali-cmp-coll__open" aria-label={`Edit ${it.title || "resource"}`} onClick={() => setForm(i)}>
                    <CollectionTileBody item={it} categories={categories} />
                  </button>
                  <div className="dali-cmp-coll__tools">
                    <button type="button" className="dali-cmp-row__tool dali-cmp-row__tool--del" aria-label={`Delete ${it.title || "resource"}`} title="Delete" onClick={() => {
                      setForm(null);
                      setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
                      toast.error(<span className="font-medium text-destructive">Resource deleted</span>, {
                        duration: 8000,
                        actions: [{ label: "Undo", onClick: () => setDraft((d) => { const items = [...d.items]; items.splice(Math.min(i, items.length), 0, it); return { ...d, items }; }) }],
                      });
                    }}>
                      <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                    </button>
                  </div>
                </div>
              ),
            )}
            {form === "new" ? (
              <CollectionForm
                initial={EMPTY_TILE}
                categories={categories}
                submitLabel="Add resource"
                onCancel={() => setForm(null)}
                onSubmit={(f) => {
                  withCategory(f.category);
                  setDraft((d) => ({ ...d, items: [...d.items, f] }));
                  setForm(null);
                }}
              />
            ) : form === null ? (
              <button type="button" className="dali-cmp-coll__tile dali-cmp-coll__tile--add" onClick={() => setForm("new")}>
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Add resource
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

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

  useEffect(() => {
    if (sel === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-piece--edit, [class*=\"devstudio\"]")) select(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [sel]);

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

function FeatureEditor({
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
  const f = draft.fields;
  const fileRef = useRef<HTMLInputElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasButton = !!(f.cta || f.href);
  const set = (patch: Record<string, string>) => {
    if ("href" in patch) setError(null);
    setDraft((d) => ({ ...d, fields: { ...d.fields, ...patch } }));
  };
  const validHref = () => {
    const href = (f.href ?? "").trim();
    if (href && !safeHref(href)) {
      setError("Enter a valid link, like https://… or mailto:…");
      return false;
    }
    return true;
  };
  const closePop = () => {
    if (validHref()) setPopOpen(false);
  };
  const done = () => {
    if (!validHref()) return setPopOpen(true);
    onSave(draft);
  };
  const pickImage = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      set({ image: await uploadEditorImage(file) });
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!popOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-feature-edit__cta, [class*=\"devstudio\"]")) closePop();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  });

  return (
    <div
      className="dali-cmp-feature-edit"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        if (popOpen) {
          setPopOpen(false);
          setError(null);
        } else onClose();
      }}
    >
      <div className="dali-cmp-foot">
        <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={done}>
          Done
        </button>
      </div>

      <div className={`dali-cmp-feature dali-cmp-tone--${f.tone || "warning"}`}>
        <div className="dali-cmp-feature-edit__artwrap">
          {f.image ? <img className="dali-cmp-feature__art" src={f.image} alt="" /> : <span className="dali-cmp-feature__art" />}
        <div className="dali-cmp-chip-pop__colors dali-cmp-feature-edit__colors" role="radiogroup" aria-label="Color">
          {TONES.map((tn) => {
            const on = f.tone === tn;
            return (
              <button
                key={tn}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={tn}
                title={tn}
                onClick={() => set({ tone: tn })}
                className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${tn}`}
              >
                {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
              </button>
            );
          })}
        </div>
          <div className="dali-cmp-feature-edit__artbtns">
            <button type="button" disabled={uploading} aria-label={f.image ? "Change image" : "Add image"} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} strokeWidth={1.5} aria-hidden />
              {uploading ? "Uploading" : f.image ? "Change image" : "Add image"}
            </button>
            {f.image && (
              <button type="button" aria-label="Remove image" title="Remove image" onClick={() => set({ image: "" })}>
                <X size={14} strokeWidth={1.5} aria-hidden />
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void pickImage(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <div className="dali-cmp-feature__body">
          <input
            aria-label="Eyebrow"
            value={f.eyebrow ?? ""}
            placeholder="Eyebrow"
            onChange={(e) => set({ eyebrow: e.target.value })}
            className="dali-cmp-eyebrow dali-cmp-feature-edit__field"
          />
          <input
            aria-label="Title"
            value={f.title ?? ""}
            placeholder="Title"
            onChange={(e) => set({ title: e.target.value })}
            className="dali-cmp-feature__title dali-cmp-feature-edit__field"
          />
          <textarea
            aria-label="Text"
            rows={1}
            value={f.body ?? ""}
            placeholder="Add text"
            onChange={(e) => set({ body: e.target.value })}
            className="dali-cmp-sub dali-cmp-feature-edit__field"
          />
          <div className="dali-cmp-feature-edit__cta" onMouseEnter={() => hasButton && setPopOpen(true)}>
            {hasButton ? (
              <button type="button" className="dali-cmp-cta" aria-expanded={popOpen} onClick={() => (popOpen ? closePop() : setPopOpen(true))}>
                {f.cta || "Button"}
              </button>
            ) : (
              <button
                type="button"
                className="dali-cmp-feature-edit__add"
                onClick={() => {
                  set({ cta: "Open" });
                  setPopOpen(true);
                }}
              >
                <Plus size={12} strokeWidth={1.5} aria-hidden />
                Add button
              </button>
            )}
            {popOpen && hasButton && (
              <div className="dali-cmp-feature-edit__pop" role="dialog" aria-label="Button">
                <label className="dali-cmp-pop-field">
                  <span>Button text</span>
                  <input autoFocus value={f.cta ?? ""} placeholder="Open" onChange={(e) => set({ cta: e.target.value })} />
                </label>
                <label className="dali-cmp-pop-field">
                  <span>URL</span>
                  <input
                    value={f.href ?? ""}
                    placeholder="https://..."
                    inputMode="url"
                    aria-invalid={!!error}
                    onChange={(e) => set({ href: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        closePop();
                      }
                    }}
                  />
                </label>
                {error && (
                  <p role="alert" className="dali-cmp-pop-error">
                    {error}
                  </p>
                )}
                <div className="dali-cmp-pop-actions">
                  <button
                    type="button"
                    className="dali-cmp-pop-delete"
                    onClick={() => {
                      set({ cta: "", href: "" });
                      setPopOpen(false);
                    }}
                  >
                    <Trash2 className="dali-cmp-ico" size={12} strokeWidth={1.5} aria-hidden />
                    Remove
                  </button>
                  <button type="button" className="dali-cmp-pop-save" onClick={closePop}>
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ComponentForm({
  def,
  initial,
  onSave,
  onClose,
}: {
  def: KindDef;
  initial: ComponentData;
  onSave: (data: ComponentData) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const itemFields = def.itemFields ?? [];

  const setItems = (items: ComponentData["items"]) => setDraft((d) => ({ ...d, items }));
  const move = (from: number, by: -1 | 1) => {
    const items = [...draft.items];
    const [it] = items.splice(from, 1);
    items.splice(from + by, 0, it!);
    setItems(items);
  };

  if (def.kind === "timeline") {
    return <TimelineEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "links") {
    return <LinksEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "stats") {
    return <StatsEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "cards") {
    return <CardsEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "gallery") {
    return <GalleryEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "collection") {
    return <CollectionEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "feature") {
    return <FeatureEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }
  if (def.kind === "chips") {
    return <ChipsEditor draft={draft} setDraft={setDraft} onSave={onSave} onClose={onClose} />;
  }

  return (
      <form
        className="dali-cmp-panel dali-cmp-inline"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <span className="dali-cmp-eyebrow">{def.title}</span>
        {def.fields.map((f) => (
          <Field
            key={f.key}
            def={f}
            value={draft.fields[f.key] ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, fields: { ...d.fields, [f.key]: v } }))}
          />
        ))}
        {itemFields.length > 0 && (
          <div className="flex flex-col gap-3">
            {draft.items.map((item, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-os-item bg-card/50 p-3">
                <div className="flex items-center gap-1">
                  <span className="os-field-label mr-auto">
                    {def.itemLabel} {i + 1}
                  </span>
                  <IconButton label="Move up" icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton
                    label="Move down"
                    icon={ArrowDown}
                    disabled={i === draft.items.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <IconButton
                    label="Remove"
                    icon={Trash2}
                    tone="destructive"
                    onClick={() => setItems(draft.items.filter((_, j) => j !== i))}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  {itemFields.map((f) => (
                    <Field
                      key={f.key}
                      def={f}
                      value={item[f.key] ?? ""}
                      onChange={(v) =>
                        setItems(draft.items.map((it, j) => (j === i ? { ...it, [f.key]: v } : it)))
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="os-add-btn os-add-btn--sm self-start"
              onClick={() => setItems([...draft.items, {}])}
            >
              <Plus className="h-4 w-4" />
              Add {def.itemLabel?.toLowerCase()}
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="dali-cmp-mini dali-cmp-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="os-btn-primary os-btn-primary--sm dali-cmp-done">
            Done
          </button>
        </div>
      </form>
  );
}

function ComponentBlock({
  kind,
  data,
  editable,
  onSave,
  onRemove,
}: {
  kind: string;
  data: string;
  editable: boolean;
  onSave: (data: ComponentData) => void;
  onRemove?: () => void;
}) {
  const def = kindDef(kind);
  const saved = parseComponentData(kind, data);
  const isNew = saved.fields._new === "1";
  const [editing, setEditing] = useState(isNew && editable);
  const [live, setLive] = useState<ComponentData["items"] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const parsed = live ? { ...saved, items: live } : saved;
  const reorderable = editable && !editing && kind === "cards";

  // Pinned cards can be dragged in place: the order updates live under the
  // pointer and is saved when the drag ends.
  useEffect(() => {
    if (!reorderable) return;
    const cards = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>(".dali-cmp-grid > *") ?? []);
    cards.forEach((c, i) => {
      c.draggable = true;
      c.classList.toggle("dali-cmp-card--dragging", dragIdx.current === i);
    });
  });
  const cardIndex = (t: EventTarget) => {
    const grid = wrapRef.current?.querySelector(".dali-cmp-grid");
    const card = (t as Element).closest?.(".dali-cmp-grid > *");
    return grid && card ? Array.from(grid.children).indexOf(card) : -1;
  };
  const dragHandlers = reorderable
    ? {
        onDragStart: (e: React.DragEvent) => {
          const i = cardIndex(e.target);
          if (i < 0) return;
          dragIdx.current = i;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(i));
          setLive([...saved.items]);
        },
        onDragOver: (e: React.DragEvent) => {
          if (dragIdx.current === null) return;
          e.preventDefault();
          const to = cardIndex(e.target);
          const from = dragIdx.current;
          if (to < 0 || to === from) return;
          dragIdx.current = to;
          setLive((cur) => {
            const items = [...(cur ?? saved.items)];
            const [it] = items.splice(from, 1);
            items.splice(to, 0, it!);
            return items;
          });
        },
        onDrop: (e: React.DragEvent) => e.preventDefault(),
        onDragEnd: () => {
          const items = live;
          dragIdx.current = null;
          setLive(null);
          if (items && items.some((it, i) => it !== saved.items[i])) onSave({ ...saved, items });
        },
      }
    : {};

  if (!def) {
    return (
      <div className="dali-cmp dali-cmp--unknown" contentEditable={false}>
        Unsupported component
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="dali-cmp" data-component={kind} contentEditable={false} {...dragHandlers}>
      {editing ? (
        <ComponentForm
          def={def}
          initial={parsed}
          onClose={() => {
            if (isNew) onRemove?.();
            else setEditing(false);
          }}
          onSave={(next) => {
            const { _new: _flag, ...fields } = next.fields;
            onSave({ ...next, fields });
            setEditing(false);
          }}
        />
      ) : (
        <>
          <ComponentView kind={kind} data={parsed} />
          {editable && (
            <button
              type="button"
              className="dali-cmp-edit"
              aria-label={`Edit ${def.title}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
        </>
      )}
    </div>
  );
}

const createComponentBlock = createReactBlockSpec(componentConfig, {
  render: (props) => (
    <ComponentBlock
      kind={props.block.props.kind}
      data={props.block.props.data}
      editable={props.editor.isEditable}
      onSave={(next) =>
        props.editor.updateBlock(props.block, { props: { data: JSON.stringify(next) } })
      }
      onRemove={() => props.editor.removeBlocks([props.block])}
    />
  ),
});

export const ComponentSpec = createComponentBlock();
