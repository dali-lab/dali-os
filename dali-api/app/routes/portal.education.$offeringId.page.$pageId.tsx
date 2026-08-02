import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.page.$pageId";
import { requireEnrollment } from "~/education/lib/access.server";
import { readMaterialPage } from "~/education/lib/lms.server";
import { DocEditor, countWords } from "~/components/doc";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Page"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireEnrollment(request, params.offeringId!, "portal");
  const page = await readMaterialPage(params.offeringId!, params.pageId!);
  if (!page) throw new Response("Not found", { status: 404 });
  // readMaterialPage returns compat ProseMirror JSON; the read-only DocEditor
  // wants block JSON.
  return {
    offeringId: params.offeringId!,
    page: { ...page, content: ensureBlocks(page.content) },
  };
}

export default function PortalMaterialPage() {
  const { offeringId, page } = useLoaderData<typeof loader>();

  return (
    <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-4">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link
            to={`/portal/education/${offeringId}/hub?tab=materials`}
            className="hover:underline"
          >
            ← Materials
          </Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-dark-blue">
          {page.title}
        </h1>
      </header>
      <div className="bg-card border border-border rounded-lg p-5">
        {countWords(page.content) === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            Nothing written here yet.
          </p>
        ) : (
          // "document" so nothing a page-doc can hold gets schema-stripped.
          <DocEditor features="document" editable={false} initialContent={page.content} />
        )}
      </div>
    </div>
  );
}
