import { useState } from "react";
import { History } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { pageDocName } from "~/collab/roomName";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { VersionHistoryPanel } from "~/components/collab/VersionHistoryPanel";

// Slim partner-facing page view. Deliberately NOT DocumentEditor: its title
// save, TagPicker, and export links all hit member-gated APIs that would 403
// for a partner session. The body is view-only for partners — the editor is
// not editable here and the collab server marks the connection read-only (see
// server.ts) — but the comments rail (/api/comments authorizes partners for
// `doc` threads on partner-visible pages) lets them leave feedback. On wide
// screens the comments sit as a right-hand rail beside the document.
//
// `features="document"` (not a slimmer preset) because the body was authored
// with the full document schema — a reader missing block types would strip
// them from the rendered view.
export function PartnerDocumentView({
  pageId,
  title,
  collabToken,
  userName,
  currentUserId,
}: {
  pageId: string;
  title: string;
  collabToken: string | null;
  userName: string;
  currentUserId: string;
}) {
  const documentName = pageDocName(pageId);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-3xl font-bold text-dark-blue">{title}</h1>
      {collabToken ? (
        <PresenceProvider pageId={pageId} token={collabToken} userName={userName}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <PresenceBar />
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  title="Version history"
                  aria-label="Version history"
                  className="ml-auto inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <History className="h-3.5 w-3.5" /> History
                </button>
              </div>
              <DocEditor
                features="document"
                editable={false}
                collab={{
                  documentName,
                  token: collabToken,
                  userName,
                }}
                placeholder="No content yet."
                className="border border-border rounded-md bg-card px-3 py-2"
              />
              {historyOpen && (
                <VersionHistoryPanel
                  documentName={documentName}
                  onClose={() => setHistoryOpen(false)}
                />
              )}
            </div>
            <aside className="border-t border-border pt-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:w-80 lg:flex-shrink-0 lg:self-start lg:overflow-y-auto lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              <CommentsRail
                targetType="doc"
                targetId={pageId}
                currentUserId={currentUserId}
                canComment
                canResolve={false}
              />
            </aside>
          </div>
        </PresenceProvider>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Sign in again to open this page.
        </p>
      )}
    </div>
  );
}
