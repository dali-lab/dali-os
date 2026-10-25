import { useId, useRef } from "react";
import { applyEditorKey } from "./code-keys";

export function CodeEditor({ path, value, onChange }: { path: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = value.split("\n").length;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const edit = applyEditorKey(
      { value: el.value, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd },
      { key: e.key, shiftKey: e.shiftKey },
    );
    if (!edit) return;
    e.preventDefault();
    onChange(edit.value);
    // The controlled value lands on the next render; restore the caret after it.
    requestAnimationFrame(() => el.setSelectionRange(edit.selectionStart, edit.selectionEnd));
  };

  return (
    <div className="flex h-full min-h-0 bg-os-well">
      <label htmlFor={id} className="sr-only">
        Editing {path}
      </label>
      <div
        ref={gutterRef}
        aria-hidden
        className="shrink-0 select-none overflow-hidden py-4 pl-4 pr-3 text-right font-mono text-[13px] leading-6 text-os-muted"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
        <div className="h-40" />
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
        }}
        wrap="off"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="min-w-0 flex-1 resize-none overflow-auto whitespace-pre bg-transparent pb-40 pl-1 pr-8 pt-4 font-mono text-[13px] leading-6 text-foreground caret-os-accent outline-none [tab-size:2]"
      />
    </div>
  );
}
