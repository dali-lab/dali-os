import { useEffect, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { Loader2 } from "lucide-react";
import { DocumentEditor } from "~/components/DocumentEditor";
import { PanelFrame } from "~/components/side-panel/PanelFrame";
import { type PanelLoad, type SidePanel } from "~/lib/side-panel";
import type { loader as documentLoader } from "~/routes/documents.$pageId";

type PanelHeader = { title: string; icon: string | null };

const MAX_CACHED_HEADERS = 50;
const headerCache = new Map<string, PanelHeader>();

export function clearDocumentPanelHeaders() {
  headerCache.clear();
}

function rememberHeader(id: string, header: PanelHeader) {
  headerCache.delete(id);
  headerCache.set(id, header);
  if (headerCache.size > MAX_CACHED_HEADERS) {
    headerCache.delete(headerCache.keys().next().value as string);
  }
}

type DocumentData = Extract<Awaited<ReturnType<typeof documentLoader>>, { pageId: string }>;

export default function DocumentPanel({ panel, onClose }: { panel: SidePanel; onClose: () => void }) {
  const fetcher = useFetcher<PanelLoad>();
  const { load } = fetcher;
  useEffect(() => {
    load(`/api/documents/${panel.id}/panel`);
  }, [load, panel.id]);

  const result = fetcher.data;
  const doc = result?.kind === "doc" ? (result.data as DocumentData) : null;
  const cached = doc ? undefined : headerCache.get(panel.id);

  useEffect(() => {
    if (doc) rememberHeader(panel.id, { title: doc.title, icon: doc.iconEmoji ?? null });
  }, [doc, panel.id]);

  let body: ReactNode;
  if (!result) {
    body = cached ? (
      <div data-testid="panel-body-placeholder" aria-busy="true" className="space-y-3 px-6 py-8">
        <div className="h-4 w-2/3 animate-pulse rounded bg-os-hover motion-reduce:animate-none" />
        <div className="h-4 w-full animate-pulse rounded bg-os-hover motion-reduce:animate-none" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-os-hover motion-reduce:animate-none" />
      </div>
    ) : (
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
    <PanelFrame
      panel={panel}
      title={doc?.title ?? cached?.title ?? ""}
      icon={doc ? doc.iconEmoji : cached?.icon}
      onClose={onClose}
    >
      {body}
    </PanelFrame>
  );
}

