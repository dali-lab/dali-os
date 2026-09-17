import { type ComponentProps, useEffect, useState } from "react";
import { DocEditor, countWords } from "~/components/doc";
import { PresenceProvider } from "~/components/collab/PresenceProvider";

// The body of a course material page, shared by the member and portal viewers.
// A read-only material renders its content statically (SSR-safe). A shared doc
// (studentEditable) renders the same live collaborative editor the instructor
// uses — enrolled students co-edit it in place, which is what lets shared docs
// live on the timeline instead of a separate Workspace tab (education-student-hub).

type DocContent = ComponentProps<typeof DocEditor>["initialContent"];

export function MaterialPageBody({
  pageId,
  studentEditable,
  content,
  collabToken,
  userName,
}: {
  pageId: string;
  studentEditable: boolean;
  /** Block JSON for a read-only material; null for a shared doc (edited live). */
  content: DocContent;
  collabToken: string | null;
  userName: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (studentEditable) {
    if (!collabToken) {
      return (
        <p className="text-sm text-muted-foreground italic">
          Sign in again to open this shared doc.
        </p>
      );
    }
    return (
      <div className="rounded-lg border border-border bg-card p-2">
        <p className="px-2 pb-1 pt-1 text-xs text-muted-foreground">
          Shared doc — everyone enrolled can edit. Changes save automatically.
        </p>
        {/* The collab editor can't render on the server, so gate on mount. */}
        {mounted ? (
          <PresenceProvider pageId={`doc:${pageId}`} token={collabToken} userName={userName}>
            <DocEditor
              features="notes"
              collab={{
                documentName: `doc:${pageId}:body`,
                token: collabToken,
                userName,
              }}
              placeholder="Start writing together…"
              className="rounded-md border border-border"
            />
          </PresenceProvider>
        ) : (
          <div className="h-40 animate-pulse rounded-md border border-border bg-muted/30" />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      {countWords(content) === 0 ? (
        <p className="text-sm text-muted-foreground italic">Nothing written here yet.</p>
      ) : (
        // "document" so nothing a page-doc can hold gets schema-stripped.
        <DocEditor features="document" editable={false} initialContent={content} />
      )}
    </div>
  );
}
