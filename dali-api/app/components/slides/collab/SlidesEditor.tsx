import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

export interface SlidesEditorProps {
  pageId: string;
  title: string;
  iconEmoji: string | null;
  canManageAccess: boolean;
  workspaceType: string;
  collab: { token: string; userId: string; userName: string; photoUrl: string | null };
  /** Buttons that sit after Share in the page bar, such as Present. */
  actionsSlot?: ReactNode;
}

const SlidesEditorImpl = lazy(() => import("./SlidesEditorImpl"));

function Loading() {
  return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">Loading deck…</div>;
}

/** The collaborative deck editor. Client only: BlockNote and the collab provider load after hydration. */
export function SlidesEditor(props: SlidesEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Loading />;
  return (
    <Suspense fallback={<Loading />}>
      <SlidesEditorImpl {...props} />
    </Suspense>
  );
}
