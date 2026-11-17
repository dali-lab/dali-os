import { Check, Columns2, Rows2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "~/components/ui/toast";
import { useOutsideDismiss } from "~/components/ui/floating";
import { TONES, safeHref, type ComponentData } from "../kinds";

export function ChipsEditor({
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

  useOutsideDismiss(urlOpen !== null, ".dali-cmp-chip--edit", () => openPop(null));

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

