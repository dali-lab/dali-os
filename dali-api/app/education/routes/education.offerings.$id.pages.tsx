import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.offerings.$id.pages";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) return new Response("Not found", { status: 404 });
  const pages = await prisma.page.findMany({
    where: {
      workspaceType: "EducationOffering",
      workspaceId: params.id,
      archivedAt: null,
      parentPageId: null,
    },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: {
      children: {
        where: { archivedAt: null },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  return { offering, pages };
}

export default function PagesTab() {
  const { offering, pages } = useLoaderData<typeof loader>();
  return (
    <div className="max-w-3xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      <div className="bg-card border border-border rounded-md p-4">
        <p className="text-sm text-muted-foreground mb-3">
          Pages scoped to this offering's workspace. The page editor itself is
          part of a separate track — this list links into it once it ships.
        </p>
        {pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pages yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {pages.map((p) => (
              <li key={p.id}>
                <span>{p.iconEmoji ?? "📄"} {p.title}</span>
                {p.children.length > 0 && (
                  <ul className="ml-6 mt-1 space-y-1">
                    {p.children.map((c) => (
                      <li key={c.id}>
                        {c.iconEmoji ?? "📄"} {c.title}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
