import { useEffect, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { Loader2 } from "lucide-react";
import { DocumentEditor } from "~/components/DocumentEditor";
import { PanelFrame } from "~/components/side-panel/PanelFrame";
import { panelLocation, type PanelLoad, type SidePanel } from "~/lib/side-panel";
import type { loader as documentLoader } from "~/routes/documents.$pageId";

type DocumentData = Extract<Awaited<ReturnType<typeof documentLoader>>, { pageId: string }>;

export default function DocumentPanel({ panel, onClose }: { panel: SidePanel; onClose: () => void }) {
  const fetcher = useFetcher<PanelLoad>();
  const { load } = fetcher;
  useEffect(() => {
    load(`/api/documents/${panel.id}/panel`);
  }, [load, panel.id]);

  const result = fetcher.data;
  const doc = result?.kind === "doc" ? (result.data as DocumentData) : null;

  let body: ReactNode;
  if (!result) {
    body = (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-os-accent motion-reduce:animate-none" />
      </div>
    );
  } else if (doc) {
    body = (
      <DocumentEditor
        key={doc.pageId}
        pageId={doc.pageId}
        initialTitle={doc.title}
        collabToken={doc.collabToken}
        userName={doc.userName}
        currentUserId={doc.currentUserId}
        photoUrl={doc.photoUrl}
        subtitle={doc.subtitle}
        canEdit={doc.canEdit}
        canComment={doc.canComment}
        canManageAccess={doc.canManageAccess}
        favorited={doc.favorited}
        workspaceType={doc.workspaceType}
        workspaceId={doc.workspaceId}
        tags={doc.tags}
        allTags={doc.allTags}
        iconEmoji={doc.iconEmoji}
        coverImageUrl={doc.coverImageUrl}
        isTemplate={doc.isTemplate}
        typography={doc.typography}
        updatedAt={doc.updatedAt}
        backlinks={doc.backlinks}
        meetingNoteTemplateAction={doc.meetingNoteTemplateAction}
        notebookConversion={doc.notebookConversion}
        aiEnabled
        chrome="panel"
      />
    );
  } else if (result.kind === "elsewhere") {
    body = (
      <p className="py-12 text-center text-sm text-muted-foreground">
        This can&apos;t open in the panel.{" "}
        <Link to={result.href} className="font-medium text-os-accent hover:underline">
          Open it as a page
        </Link>
      </p>
    );
  } else {
    body = (
      <p className="py-12 text-center text-sm text-muted-foreground">
        This document doesn&apos;t exist or you don&apos;t have access.
      </p>
    );
  }

  return (
    <PanelFrame panel={panel} title={doc?.title ?? ""} location={panelLocation(doc?.workspaceType)} onClose={onClose}>
      {body}
    </PanelFrame>
  );
}

