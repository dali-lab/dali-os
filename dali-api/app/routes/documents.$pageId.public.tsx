import { useLoaderData } from "react-router";
import type { Route } from "./+types/documents.$pageId.public";
import { prisma } from "~/lib/db";
import { DocEditor } from "~/components/doc";
import { PageIcon } from "~/components/PageIcon";
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
    blocks,
    updatedAt: page.updatedAt.toISOString(),
  };
}

export default function PublicDocument() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-6 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
          <span>Shared via link · read-only</span>
        </div>
        <h1 className="mb-8 flex items-center gap-3 text-3xl font-semibold text-neutral-900">
          <PageIcon iconEmoji={data.iconEmoji} />
          {data.title}
        </h1>
        <DocEditor features="document" editable={false} initialContent={data.blocks} />
      </div>
    </div>
  );
}
