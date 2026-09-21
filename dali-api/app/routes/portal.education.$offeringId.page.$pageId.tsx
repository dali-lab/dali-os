import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.education.$offeringId.page.$pageId";
import { requireEnrollment } from "~/education/lib/access.server";
import { readMaterialPage } from "~/education/lib/lms.server";
import { prisma } from "~/lib/db";
import { parseSessionCookie } from "~/lib/cookies";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { MaterialPageBody } from "~/education/components/MaterialPageBody";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Page"} · DALI` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { auth } = await requireEnrollment(request, params.offeringId!, "portal");
  const page = await readMaterialPage(params.offeringId!, params.pageId!);
  if (!page) throw new Response("Not found", { status: 404 });
  const me = page.studentEditable
    ? await prisma.user.findUnique({
        where: { id: auth.user.sub },
        select: { firstName: true, lastName: true },
      })
    : null;
  return {
    offeringId: params.offeringId!,
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
  };
}

export default function PortalMaterialPage() {
  const { offeringId, page, collabToken, userName } = useLoaderData<typeof loader>();

  return (
    <div className="w-full px-4 sm:px-6 py-8 flex flex-col gap-4">
      <header>
        <p className="text-xs text-muted-foreground">
          <Link
            to={`/portal/education/${offeringId}/hub?tab=sessions`}
            className="hover:underline"
          >
            ← Timeline
          </Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold text-dark-blue">
          {page.title}
        </h1>
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
