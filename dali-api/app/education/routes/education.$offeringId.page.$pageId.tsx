import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/education.$offeringId.page.$pageId";
import { requireEnrollment } from "~/education/lib/access.server";
import { readMaterialPage } from "~/education/lib/lms.server";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { MaterialPageBody } from "~/education/components/MaterialPageBody";
import { buttonClasses } from "~/components/ui/Button";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Page"} · DALI OS` },
];

export const handle = {
  // Offering pages name themselves in their own headers, so the trail above
  // them only repeated where you already are.
  hideBreadcrumbs: true,
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
      { label: "Sessions", to: `${hub}?tab=sessions` },
      { label: data.page.title },
    ];
  },
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth, isManager } = await requireEnrollment(
    request,
    params.offeringId!,
    "member",
  );
  const page = await readMaterialPage(params.offeringId!, params.pageId!);
  if (!page) throw new Response("Not found", { status: 404 });
  const [offering, me] = await Promise.all([
    prisma.educationOffering.findUnique({
      where: { id: params.offeringId! },
      select: { title: true },
    }),
    // Only the shared-doc (co-edit) path needs the author's display name.
    page.studentEditable
      ? prisma.user.findUnique({
          where: { id: auth.user.sub },
          select: { firstName: true, lastName: true },
        })
      : Promise.resolve(null),
  ]);
  return {
    offeringId: params.offeringId!,
    offeringTitle: offering?.title ?? "Offering",
    page: {
      id: page.id,
      title: page.title,
      studentEditable: page.studentEditable,
      // readMaterialPage returns compat ProseMirror JSON for read-only pages; the
      // read-only DocEditor wants block JSON. Shared docs render live (no content).
      content: page.studentEditable ? null : ensureBlocks(page.content),
    },
    collabToken: page.studentEditable ? parseSessionCookie(request) : null,
    userName: me ? `${me.firstName} ${me.lastName}`.trim() : "Student",
    isManager,
  };
}

export default function MaterialPage() {
  const { page, collabToken, userName, isManager } = useLoaderData<typeof loader>();

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
      <MaterialPageBody
        pageId={page.id}
        studentEditable={page.studentEditable}
        content={page.content}
        collabToken={collabToken}
        userName={userName}
      />
    </div>
  );
}
