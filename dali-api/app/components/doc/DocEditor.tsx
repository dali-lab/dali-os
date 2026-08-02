// THE app editor — SSR-safe public entry point.
//
// ── How to use (Wave-2 surfaces): import { DocEditor } from "~/components/doc"
// directly in any route module. This wrapper keeps the entire BlockNote stack
// (@blocknote/*, yjs, @hocuspocus/provider, y-indexeddb, shiki) OUT of the SSR
// module graph and out of the route's initial chunk:
//
//   1. React.lazy(() => import("./DocEditorImpl")) — the heavy editor (and its
//      CSS imports) lives in a separate client chunk, loaded on demand.
//   2. A mounted gate (useState + useEffect) — the lazy chunk is only ever
//      requested in the browser, after hydration. Server render and hydration
//      both produce the same lightweight fallback shell, so there's no
//      hydration mismatch and no "window is not defined" during SSR.
//
// The same pattern proved out in the spike routes and mirrors the legacy
// CollaborativeEditor's mount-after-effect gate. Don't import DocEditorImpl
// directly from a route — that reintroduces BlockNote to the SSR graph.
//
// Everything else exported from "~/components/doc" (buildSchema, insert
// helpers, SigningContext, configs, pure utils) is either runtime-light or
// type-only; see index.ts.

import { lazy, Suspense, useEffect, useState } from "react";
import type { DocEditorProps } from "./types";

const DocEditorImpl = lazy(() => import("./DocEditorImpl"));

/** Placeholder shell shown during SSR / while the editor chunk loads. Sized to
 * roughly match an empty editor so layout doesn't jump. */
export function DocEditorFallback({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="min-h-[6rem] px-3 py-2 text-sm italic text-muted-foreground">
        Loading editor…
      </div>
    </div>
  );
}

export function DocEditor(props: DocEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <DocEditorFallback className={props.className} />;

  return (
    <Suspense fallback={<DocEditorFallback className={props.className} />}>
      <DocEditorImpl {...props} />
    </Suspense>
  );
}
