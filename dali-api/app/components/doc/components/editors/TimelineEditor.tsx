import { Flag, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDialog } from "~/components/ui/dialog";
import { useOutsideDismiss } from "~/components/ui/floating";
import { TONES, type ComponentData } from "../kinds";

export function TimelineEditor({
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

  const closeFan = () => {
    setFanPin(null);
    setFanOpen(null);
  };
  useOutsideDismiss(fanPin !== null, ".dali-cmp-step__numwrap", closeFan, { escape: true });
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

