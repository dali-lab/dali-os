import { lazy, Suspense, useEffect, useState } from "react";

export interface WhiteboardEditorProps {
  pageId: string;
  title: string;
  iconEmoji: string | null;
  canEdit: boolean;
  /** Raw session id used as the Hocuspocus auth token; null if unauthenticated. */
  collabToken: string | null;
  userName: string;
  currentUserId: string;
  photoUrl: string | null;
}

// Excalidraw touches window/document and must not be server-rendered or even
// imported during SSR. Mirror the DocEditor pattern: gate on a client mount,
// then lazy-load the heavy implementation (which pulls in @excalidraw/excalidraw)
// only in the browser.
const WhiteboardImpl = lazy(() => import("./WhiteboardImpl"));

function WhiteboardFallback() {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      Loading whiteboard…
    </div>
  );
}

export function WhiteboardEditor(props: WhiteboardEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <WhiteboardFallback />;
  return (
    <Suspense fallback={<WhiteboardFallback />}>
      <WhiteboardImpl {...props} />
    </Suspense>
  );
}
