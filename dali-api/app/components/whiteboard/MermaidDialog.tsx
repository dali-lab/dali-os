import { useId, useRef, useState } from "react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
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

// Our own diagram tool: a DALI modal that turns Mermaid syntax into native
// Excalidraw elements. Unlike Excalidraw's built-in converter (which hard-codes
// its hand-drawn styling), the caller normalizes the output to the board's clean
// look before inserting. Mermaid itself is heavy, so it's imported lazily on use.
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
  const [text, setText] = useState(SAMPLE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function handleInsert() {
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
      const { elements, files } = await parseMermaidToExcalidraw(value);
      const converted = convertToExcalidrawElements(elements, { regenerateIds: true });
      onInsert({ elements: converted, files: files ?? null });
      onClose();
    } catch {
      setError("Couldn't read that diagram. Check the Mermaid syntax and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} initialFocusRef={textareaRef}>
      <ModalHeader
        titleId={titleId}
        title="Insert diagram"
        subtitle="Describe a diagram in Mermaid. It's inserted as clean, editable shapes."
        onClose={onClose}
      />
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        spellCheck={false}
        className="w-full resize-y rounded-md border border-border bg-card p-3 font-mono text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/30"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <ModalFooter onCancel={onClose}>
        <Button variant="primary" onClick={() => void handleInsert()} disabled={busy || !text.trim()}>
          {busy ? "Inserting…" : "Insert"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
