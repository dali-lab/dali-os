import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.page.$pageId";
import { requireEnrollment } from "~/education/lib/access.server";
import { readMaterialPage } from "~/education/lib/lms.server";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Page"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireEnrollment(request, params.offeringId!, "portal");
  const page = await readMaterialPage(params.offeringId!, params.pageId!);
  if (!page) throw new Response("Not found", { status: 404 });
  return { offeringId: params.offeringId!, page };
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
