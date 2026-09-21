import { useEffect, useId, useRef, useState } from "react";
import { convertToExcalidrawElements, exportToSvg, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { modalCardClass } from "~/components/os-chrome";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { Button } from "~/components/ui/Button";

export type DiagramInsert = {
  elements: ReturnType<typeof convertToExcalidrawElements>;
  files: BinaryFiles | null;
};

const SAMPLE = `flowchart TD
  A[Christmas] --> B(Go shopping)
  B --> C{Let me think}
  C -->|One| D[Laptop]
  C -->|Two| E[iPhone]
  C -->|Three| F[Car]`;

// Normalize converted elements to the board's clean style (no hand-drawn font /
// sketchy fill) so the preview matches exactly what gets inserted.
function normalize(elements: ReturnType<typeof convertToExcalidrawElements>) {
  for (const el of elements) {
    (el as { roughness: number }).roughness = 0;
    (el as { fillStyle: string }).fillStyle = "solid";
    if (el.type === "text") (el as { fontFamily: number }).fontFamily = FONT_FAMILY.Nunito;
  }
  return elements;
}

// Our own diagram tool, replacing Excalidraw's built-in Mermaid converter (which
// hard-codes hand-drawn output). Mirrors its split input/preview UI, but the
// output is normalized to the board's clean style. Mermaid is heavy, so it's
// imported lazily on first keystroke.
export function MermaidDialog({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (payload: DiagramInsert) => void;
}) {
  const titleId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const parsedRef = useRef<DiagramInsert | null>(null);
  const [text, setText] = useState(SAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Live preview: debounce, parse (lazy), convert, normalize, render an SVG.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const value = text.trim();
    setReady(false);
    parsedRef.current = null;
    if (!value) {
      setError(null);
      previewRef.current?.replaceChildren();
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        const { elements, files } = await parseMermaidToExcalidraw(value);
        const converted = normalize(convertToExcalidrawElements(elements, { regenerateIds: true }));
        if (cancelled) return;
        parsedRef.current = { elements: converted, files: files ?? null };
        setError(null);
        setReady(true);
        const svg = await exportToSvg({
          elements: converted,
          appState: { exportBackground: false },
          files: files ?? null,
        });
        if (cancelled || !previewRef.current) return;
        svg.style.maxWidth = "100%";
        svg.style.maxHeight = "100%";
        previewRef.current.replaceChildren(svg);
      } catch {
        if (cancelled) return;
        parsedRef.current = null;
        setReady(false);
        setError("Check the Mermaid syntax and try again.");
        previewRef.current?.replaceChildren();
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, open]);

  if (!open) return null;

  function handleInsert() {
    if (!parsedRef.current) return;
    onInsert(parsedRef.current);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      initialFocusRef={textareaRef}
      containerClassName={modalCardClass("max-w-3xl")}
    >
      <ModalHeader
        titleId={titleId}
        title="Insert diagram"
        subtitle="Describe a diagram in Mermaid. It's inserted as clean, editable shapes."
        onClose={onClose}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col">
          <span className="mb-1 text-xs font-medium text-muted-foreground">Mermaid</span>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleInsert();
              }
            }}
            rows={12}
            spellCheck={false}
            className="min-h-[280px] w-full flex-1 resize-none rounded-md border border-border bg-card p-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30"
          />
        </div>
        <div className="flex flex-col">
          <span className="mb-1 text-xs font-medium text-muted-foreground">Preview</span>
          <div
            ref={previewRef}
            className="flex min-h-[280px] flex-1 items-center justify-center overflow-auto rounded-md border border-border bg-card p-3 text-sm text-muted-foreground"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <ModalFooter onCancel={onClose}>
        <Button variant="primary" onClick={handleInsert} disabled={!ready}>
          Insert
        </Button>
      </ModalFooter>
    </Modal>
  );
}
