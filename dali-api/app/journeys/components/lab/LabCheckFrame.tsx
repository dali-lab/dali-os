import type { Ref } from "react";

/** An off-screen copy of the page that runs the step checks without touching the visible preview. */
export function LabCheckFrame({ doc, frameRef }: { doc: string; frameRef?: Ref<HTMLIFrameElement> }) {
  return (
    <iframe
      ref={frameRef}
      title="Lab checks"
      aria-hidden
      tabIndex={-1}
      sandbox="allow-scripts"
      srcDoc={doc}
      className="pointer-events-none fixed -left-[9999px] top-0 h-[600px] w-[800px] opacity-0"
    />
  );
}
