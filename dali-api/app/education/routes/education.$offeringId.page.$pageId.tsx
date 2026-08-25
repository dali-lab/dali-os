import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.$offeringId.page.$pageId";
import { requireEnrollment } from "~/education/lib/access.server";
import { readMaterialPage } from "~/education/lib/lms.server";
import { prisma } from "~/lib/db";
import { DocEditor, countWords } from "~/components/doc";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Page"} · DALI OS` },
];

export const handle = {
  // Flat routes don't nest, so the middle :offeringId is an opaque id the
  // segment walk drops — the course vanishes from the trail. Declare the full
  // trail so the page stays reachable from its offering.
  breadcrumbTrail: (
    data:
      | { offeringId: string; offeringTitle: string; page: { title: string } }
      | undefined,
  ) => {
    if (!data) return null;
    const hub = `/education/${data.offeringId}/hub`;
    return [
      { label: "Education", to: "/education" },
      { label: data.offeringTitle, to: hub },
      { label: "Materials", to: `${hub}?tab=materials` },
      { label: data.page.title },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  const page = await readMaterialPage(params.offeringId!, params.pageId!);
  if (!page) throw new Response("Not found", { status: 404 });
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.offeringId! },
    select: { title: true },
  });
  return {
    offeringId: params.offeringId!,
    offeringTitle: offering?.title ?? "Offering",
    // readMaterialPage returns compat ProseMirror JSON; the read-only DocEditor
    // wants block JSON.
    page: { ...page, content: ensureBlocks(page.content) },
    isManager,
  };
}

export default function MaterialPage() {
  const { page, isManager } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            {page.title}
          </h1>
        </div>
        {isManager && (
          <Link
            to={`/documents/${page.id}`}
            className={buttonClasses("secondary", "sm")}
          >
            Open in editor
          </Link>
        )}
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
