import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { HtmlPreviewContext } from "~/components/slides/deck/html-preview";

export interface SlidesEditorProps {
  pageId: string;
  title: string;
  iconEmoji: string | null;
  /** False for viewers: they connect read-only and watch edits arrive. */
  canEdit: boolean;
  /** Whether the viewer may read and write comments on the deck. */
  canComment: boolean;
  /** Whether the viewer may delete other people's comments. */
  canModerateComments: boolean;
  canManageAccess: boolean;
  workspaceType: string;
  collab: { token: string; userId: string; userName: string; photoUrl: string | null };
  /** The slide and thread a comment link names, to open on arrival. */
  link?: { slideId: string | null; threadId: string | null };
  /** Buttons that sit after Share in the page bar, such as Present. */
  actionsSlot?: ReactNode | ((ctx: { currentSlideId: string | null }) => ReactNode);
}

const SlidesEditorImpl = lazy(() => import("./SlidesEditorImpl"));

function Loading() {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">Loading deck…</div>;
}

/** The collaborative deck editor. Client only: BlockNote and the collab provider load after hydration. */
export function SlidesEditor(props: SlidesEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const preview = useMemo(() => ({ pageId: props.pageId }), [props.pageId]);
  if (!mounted) return <Loading />;
  return (
    <HtmlPreviewContext.Provider value={preview}>
      <Suspense fallback={<Loading />}>
        <SlidesEditorImpl {...props} />
      </Suspense>
    </HtmlPreviewContext.Provider>
  );
}
