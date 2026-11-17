import { useEffect, useState } from "react";

export type DialogueChoice = { label: string; onPick: () => void };

export type DialogueSpec = {
  name: string;
  portrait: string;
  lines: string[];
  // Shown on the last line; picking one closes the dialogue via its handler.
  choices?: DialogueChoice[];
};

// Classic RPG bottom box: portrait, name, one line at a time with back and
// forth, selectable answers at the end.
export function DialogueBox({ spec, onClose }: { spec: DialogueSpec; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [spec]);
  const last = index >= spec.lines.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.key === "Enter" || e.key === " ") && !(last && spec.choices?.length)) {
        e.preventDefault();
        if (last) onClose();
        else setIndex((i) => i + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, spec, onClose]);

  return (
    <section className="ag-dialogue" aria-label={`${spec.name} says`}>
      <div className="ag-dialogue-portrait">
        <img src={spec.portrait} alt="" />
        <span>{spec.name}</span>
      </div>
      <div className="ag-dialogue-body">
        <button
          type="button"
          className="ag-dialogue-text"
          onClick={() => {
            if (!last) setIndex(index + 1);
            else if (!spec.choices?.length) onClose();
          }}
        >
          {spec.lines[index]}
          {!last ? <i className="ag-dialogue-more">▼</i> : null}
        </button>
        <div className="ag-dialogue-nav">
          <button type="button" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
            ◀ Back
          </button>
          {!last ? (
            <button type="button" onClick={() => setIndex(index + 1)}>
              Next ▶
            </button>
          ) : !spec.choices?.length ? (
            <button type="button" onClick={onClose}>
              Close ✕
            </button>
          ) : null}
        </div>
        {last && spec.choices?.length ? (
          <div className="ag-dialogue-choices">
            {spec.choices.map((c) => (
              <button key={c.label} type="button" onClick={c.onPick}>
                ▸ {c.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
