import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.$offeringId.page.$pageId";
import { requireEnrollment } from "~/education/lib/access.server";
import { readMaterialPage } from "~/education/lib/lms.server";
import { prisma } from "~/lib/db";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
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
    page,
    isManager,
  };
}

export default function MaterialPage() {
  const { offeringId, page, isManager } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link
              to={`/education/${offeringId}/hub?tab=materials`}
              className="hover:underline"
            >
              ← Materials
            </Link>
          </p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-foreground">
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
        {isEmptyDoc(page.content) ? (
          <p className="text-sm text-muted-foreground italic">
            Nothing written here yet.
          </p>
        ) : (
          <RichTextViewer content={page.content} />
        )}
      </div>
    </div>
  );
}
