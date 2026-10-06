import { useLoaderData } from "react-router";
import type { Route } from "./+types/documents.$pageId.public";
import { prisma } from "~/lib/db";
import { cn } from "~/lib/cn";
import { normalizePageTypography } from "~/lib/page-typography";
import { DocEditor } from "~/components/doc";
import { PageCover } from "~/components/doc-chrome/PageCover";
import { PageIconPicker } from "~/components/doc-chrome/PageIconPicker";
import { useOsChrome } from "~/components/os-chrome";
import { readDocAsBlocks } from "~/collab/read";
import { pageDocName } from "~/collab/roomName";

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Shared document · DALI OS" }];
};

// GET /documents/:pageId/public — the read-only render served to anyone with an
// "Anyone with the link" document, WITHOUT a DALI account. Sits outside the app
// shell layout (which requires auth); the shell's gate transparently routes an
// unauthenticated visitor of the canonical /documents/:pageId here when the doc
// is public, so the copied link stays the plain doc URL. Never opens a collab
// socket — the body is rendered from a server-side snapshot, so there is no
// write surface to gate.
export async function loader({ params }: Route.LoaderArgs) {
  const page = await prisma.page.findUnique({
    where: { id: params.pageId },
    select: {
      id: true,
      title: true,
      iconEmoji: true,
      coverImageUrl: true,
      typography: true,
      archivedAt: true,
      linkAccess: true,
      updatedAt: true,
    },
  });
  // Only genuinely-public, live documents render here. Anything else is a 404
  // that reveals nothing about whether the page exists.
  if (!page || page.archivedAt !== null || page.linkAccess !== "Public") {
    throw new Response("Not found", { status: 404 });
  }

  const blocks = await readDocAsBlocks(pageDocName(page.id));
  return {
    title: page.title,
    iconEmoji: page.iconEmoji,
    coverImageUrl: page.coverImageUrl,
    typography: normalizePageTypography(page.typography),
    blocks,
    updatedAt: page.updatedAt.toISOString(),
  };
}

// Mirrors DocumentEditor's paper canvas (card, 54px gutter, cover, 4xl icon,
// os page title, per-page typography) so a shared link reads exactly like the
// document does in the app, minus the editing chrome.
export default function PublicDocument() {
  const data = useLoaderData<typeof loader>();
  const { pageTitle } = useOsChrome();
  const typo = data.typography;
  return (
    <div className="doc-surface min-h-screen">
      <div className="doc-canvas-outer flex justify-center pb-12 pt-4 bg-page">
        <div
          className={cn(
            "doc-canvas rounded-xl border border-border bg-card shadow-brand-1",
            typo.fullWidth ? "w-full" : "w-full max-w-[1400px]",
            typo.font !== "default" && `doc-canvas--${typo.font}`,
            typo.smallText && "doc-canvas--small",
            typo.nestingGuides && "doc-canvas--guides",
          )}
        >
          {data.coverImageUrl && (
            <PageCover coverImageUrl={data.coverImageUrl} canEdit={false} onChange={() => {}} />
          )}
          <div className="px-4 sm:px-[54px] pt-12 pb-6">
            <div className="mb-1 pl-3 sm:pl-[54px]">
              <div className="flex items-start gap-3">
                {data.iconEmoji && (
                  <div className="flex h-[50px] shrink-0 items-center">
                    <PageIconPicker iconEmoji={data.iconEmoji} canEdit={false} onChange={() => {}} />
                  </div>
                )}
                <h1 className={cn(pageTitle, "doc-title min-w-0 flex-1 leading-tight select-text")}>
                  {data.title}
                </h1>
              </div>
            </div>
            <div className="mt-4">
              <DocEditor
                features="document"
                editable={false}
                localChecklistToggle
                initialContent={data.blocks}
                className="min-h-[70vh]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
