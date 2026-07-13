import { CollaborativeEditor } from "~/components/CollaborativeEditor";
import { PresenceProvider } from "~/components/collab/PresenceProvider";
import { PresenceBar } from "~/components/collab/PresenceBar";

// Slim partner-facing page view. Deliberately NOT DocumentEditor: its title
// save, TagPicker, comments rail, and export links all hit member-gated APIs
// that would 403 for a partner session. Body editing is full collab — shared
// pages are co-edited by design.
export function PartnerDocumentView({
  pageId,
  title,
  collabToken,
  userName,
}: {
  pageId: string;
  title: string;
  collabToken: string | null;
  userName: string;
}) {
  const documentName = `doc:${pageId}:body`;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-3xl font-bold text-dark-blue">{title}</h1>
      {collabToken ? (
        <PresenceProvider pageId={pageId} token={collabToken} userName={userName}>
          <div className="flex items-center justify-end">
            <PresenceBar />
          </div>
          <CollaborativeEditor
            editorId={documentName}
            documentName={documentName}
            token={collabToken}
            userName={userName}
            placeholder="Start writing…"
            className="border border-border rounded-md bg-card"
          />
        </PresenceProvider>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          Sign in again to open this page.
        </p>
      )}
    </div>
  );
}
