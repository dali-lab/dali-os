// The `component` block (React spec over the shared componentConfig): one node
// type for the whole component library — see ../components/kinds.ts. The block
// renders its kind's view; in an editable editor it adds an Edit button that
// opens one generic form built from the kind's field definitions.

import { createReactBlockSpec } from "@blocknote/react";
import { ArrowDown, ArrowUp, Check, Columns2, Flag, GripVertical, ImagePlus, Link2, Rows2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "~/components/ui/IconButton";
import {
  TONES,
  kindDef,
  parseComponentData,
  type ComponentData,
  type FieldDef,
  type KindDef,
} from "../components/kinds";
import { ComponentView } from "../components/views";
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
  const [noteOpen, setNoteOpen] = useState(!!draft.fields.note);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusLast, setFocusLast] = useState(false);

  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
  const setItem = (i: number, patch: Record<string, string>) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const current = Number.parseInt(draft.fields.current ?? "", 10);

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
            placeholder="Add a note"
            autoFocus={!draft.fields.note}
            onChange={(e) => setField("note", e.target.value)}
            className="dali-cmp-sub dali-cmp-bare"
          />
        ) : (
          <button type="button" className="dali-cmp-mini self-start" onClick={() => setNoteOpen(true)}>
            Add a note
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
              className={`dali-cmp-step dali-cmp-step--${state}${it.tone ? ` dali-cmp-step--toned dali-cmp-tone--${it.tone}` : ""}`}
            >
              <div
                className="dali-cmp-step__numwrap"
                onMouseEnter={() => setFanOpen(i)}
                onMouseLeave={() => setFanOpen((o) => (o === i ? null : o))}
              >
                <button
                  type="button"
                  className="dali-cmp-step__num dali-cmp-step__num--btn"
                  title="Color and current step"
                  aria-label={`Step ${n} options`}
                  aria-expanded={fanOpen === i}
                  onClick={() => setFanOpen(fanOpen === i ? null : i)}
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
                          setFanOpen(null);
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
                        setFanOpen(null);
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
                  onClick={() => {
                    setFanOpen(null);
                    setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
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
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={() => onSave(draft)}>
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
    if (href && !/^(https?:\/\/|mailto:|\/|#)\S*$/i.test(href)) return "Enter a valid link, like https://…";
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
          placeholder="Section label"
          onChange={(e) => setDraft((d) => ({ ...d, fields: { ...d.fields, label: e.target.value } }))}
          className="dali-cmp-eyebrow dali-cmp-chips-edit__label"
        />
        <ul className="dali-cmp-chips__row" onDragLeave={() => setDragOver(null)}>
          {draft.items.map((it, i) => (
            <li
              key={i}
              className={`dali-cmp-chip dali-cmp-chip--edit${dragOver === i && dragFrom !== i ? " dali-cmp-chip--over" : ""}${dragFrom === i ? " dali-cmp-chip--dragging" : ""}`}
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
          <li>
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
          </li>
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
        <button type="button" className="os-btn-primary os-btn-primary--sm dali-cmp-done" onClick={() => onSave(draft)}>
          Done
        </button>
      </div>
    </div>
  );
}

function CardsEditor({
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
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [removed, setRemoved] = useState<{ item: ComponentData["items"][number]; index: number } | null>(null);
  const titleRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusTitle, setFocusTitle] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (sel === null) return setPopPos(null);
    const grid = gridRef.current;
    const card = grid?.children[sel] as HTMLElement | undefined;
    if (!grid || !card) return;
    const width = Math.min(320, grid.clientWidth);
    setPopPos({
      left: Math.max(0, Math.min(card.offsetLeft, grid.clientWidth - width)),
      top: card.offsetTop + card.offsetHeight + 8,
    });
  }, [sel, draft.items.length]);

  useEffect(() => {
    if (sel === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-card--edit, .dali-cmp-cards-edit__panel, [class*=\"devstudio\"]")) setSel(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
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

  const item = sel !== null ? draft.items[sel] : undefined;

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
          </div>
        ))}
        <button
          type="button"
          className="dali-cmp-card dali-cmp-card--add"
          onClick={() => {
            setSel(draft.items.length);
            setDraft((d) => ({ ...d, items: [...d.items, { tag: "", tone: "neutral", title: "", meta: "", href: "" }] }));
            setFocusTitle(true);
          }}
        >
          <Plus className="dali-cmp-ico" size={9} strokeWidth={1.5} aria-hidden />
          Add card
        </button>
        {item && sel !== null && (
        <div className="dali-cmp-cards-edit__panel" role="group" aria-label="Edit card" style={popPos ? { left: popPos.left, top: popPos.top } : { visibility: "hidden" }}>
          <div className="dali-cmp-cards-edit__head">
            <span>Card options</span>
          </div>
          <div className="dali-cmp-cards-edit__fields dali-cmp-cards-edit__fields--stack">
            <label className="dali-cmp-pop-field">
              <span>Link</span>
              <input value={item.href ?? ""} placeholder="Optional · https://" inputMode="url" onChange={(e) => setItem(sel, { href: e.target.value })} />
            </label>
          </div>
          <div className="dali-cmp-cards-edit__tools">
            <div className="dali-cmp-cards-edit__colors">
              <span>Color</span>
              <div className="flex gap-2" role="radiogroup" aria-label="Color">
                {TONES.map((t) => {
                  const on = (item.tone || "neutral") === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={t}
                      title={t}
                      onClick={() => setItem(sel, { tone: t })}
                      className={`dali-cmp-swatch dali-cmp-swatch--pick dali-cmp-tone--${t}`}
                    >
                      {on && <Check className="dali-cmp-ico dali-cmp-ico--check" size={9} strokeWidth={2.25} aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              className="dali-cmp-pop-delete"
              onClick={() => {
                setRemoved({ item, index: sel });
                setSel(null);
                setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== sel) }));
              }}
            >
              <Trash2 className="dali-cmp-ico" size={7} strokeWidth={1.5} aria-hidden />
              Delete card
            </button>
          </div>
        </div>
      )}
      </div>

      <div className="dali-cmp-foot" aria-live="polite">
        {removed && (
          <button
            type="button"
            className="dali-cmp-mini"
            onClick={() => {
              setDraft((d) => {
                const items = [...d.items];
                items.splice(Math.min(removed.index, items.length), 0, removed.item);
                return { ...d, items };
              });
              setSel(removed.index);
              setRemoved(null);
            }}
          >
            Card deleted · Undo
          </button>
        )}
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
            <div className="dali-cmp-stat__tools">
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
  const [sel, setSel] = useState<number | null>(null);
  const [urlOpen, setUrlOpen] = useState<number | null>(null);
  const [subOpen, setSubOpen] = useState(!!draft.fields.subtitle);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragReady, setDragReady] = useState<number | null>(null);
  const [removed, setRemoved] = useState<{ item: ComponentData["items"][number]; index: number } | null>(null);
  const [focusNew, setFocusNew] = useState(false);
  const titleRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!focusNew) return;
    titleRefs.current[draft.items.length - 1]?.focus();
    setFocusNew(false);
  }, [focusNew, draft.items.length]);

  useEffect(() => {
    if (urlOpen === null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(".dali-cmp-link-pop, .dali-cmp-row__tool--link, [class*=\"devstudio\"]")) setUrlOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [urlOpen]);

  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
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
    setUrlOpen(null);
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
          <button type="button" className="dali-cmp-mini self-start" onClick={() => setSubOpen(true)}>
            Add subtitle
          </button>
        )}
      </div>

      {draft.items.map((it, i) => (
        <div
          key={i}
          draggable={dragReady === i}
          className={`dali-cmp-row dali-cmp-row--edit${sel === i ? " dali-cmp-row--selected" : ""}${dragFrom === i ? " dali-cmp-row--dragging" : ""}`}
          onFocusCapture={() => setSel(i)}
          onClick={() => setSel(i)}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
              e.preventDefault();
              const to = i + (e.key === "ArrowUp" ? -1 : 1);
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
            className="dali-cmp-row__tool dali-cmp-row__grip"
            aria-label={`Reorder resource ${i + 1}. Drag, or use Alt plus the up and down arrow keys.`}
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
            <GripVertical size={12} strokeWidth={1.5} aria-hidden />
          </button>
          <span className="dali-cmp-row__main">
            <input
              ref={(el) => {
                titleRefs.current[i] = el;
              }}
              aria-label={`Resource ${i + 1} title`}
              value={it.title ?? ""}
              placeholder="Title"
              onChange={(e) => setItem(i, { title: e.target.value })}
              className="dali-cmp-row__title dali-cmp-row__field"
            />
            <input
              aria-label={`Resource ${i + 1} description`}
              value={it.description ?? ""}
              placeholder="Description"
              onChange={(e) => setItem(i, { description: e.target.value })}
              className="dali-cmp-sub dali-cmp-row__field"
            />
          </span>
          <div className="dali-cmp-row__tools">
            <button
              type="button"
              className={`dali-cmp-row__tool dali-cmp-row__tool--link${it.href ? " dali-cmp-row__tool--on" : ""}`}
              aria-label={`Edit link for resource ${i + 1}`}
              aria-expanded={urlOpen === i}
              title="Link"
              onClick={() => setUrlOpen(urlOpen === i ? null : i)}
            >
              <Link2 size={12} strokeWidth={1.5} aria-hidden />
            </button>
            <button
              type="button"
              className="dali-cmp-row__tool dali-cmp-row__tool--del"
              aria-label={`Delete resource ${i + 1}`}
              title="Delete"
              onClick={() => {
                setRemoved({ item: it, index: i });
                setSel(null);
                setUrlOpen(null);
                setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
              }}
            >
              <Trash2 size={12} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          {urlOpen === i && (
            <div
              className="dali-cmp-link-pop"
              role="dialog"
              aria-label="Link"
              onKeyDown={(e) => {
                if (e.key === "Escape" || e.key === "Enter") {
                  e.stopPropagation();
                  setUrlOpen(null);
                }
              }}
            >
              <span>Link</span>
              <input
                autoFocus
                value={it.href ?? ""}
                placeholder="https://"
                inputMode="url"
                onChange={(e) => setItem(i, { href: e.target.value })}
              />
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        className="dali-cmp-row dali-cmp-row--add"
        onClick={() => {
          setSel(draft.items.length);
          setDraft((d) => ({ ...d, items: [...d.items, { title: "", description: "", meta: "", href: "" }] }));
          setFocusNew(true);
        }}
      >
        <Plus size={11} strokeWidth={1.5} aria-hidden />
        Add resource
      </button>

      <div className="dali-cmp-foot" aria-live="polite">
        {removed && (
          <button
            type="button"
            className="dali-cmp-mini"
            onClick={() => {
              setDraft((d) => {
                const items = [...d.items];
                items.splice(Math.min(removed.index, items.length), 0, removed.item);
                return { ...d, items };
              });
              setSel(removed.index);
              setRemoved(null);
            }}
          >
            Resource deleted · Undo
          </button>
        )}
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
}: {
  kind: string;
  data: string;
  editable: boolean;
  onSave: (data: ComponentData) => void;
}) {
  const def = kindDef(kind);
  const saved = parseComponentData(kind, data);
  const [editing, setEditing] = useState(false);
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
          onClose={() => setEditing(false)}
          onSave={(next) => {
            onSave(next);
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
    />
  ),
});

export const ComponentSpec = createComponentBlock();
