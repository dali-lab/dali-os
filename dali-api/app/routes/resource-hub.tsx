import { CoverPattern, isPatternCover } from "~/components/resource-hub/CoverPattern";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Plus } from "lucide-react";
import type { Route } from "./+types/resource-hub";
import { prisma } from "~/lib/db";
import {
  ledDomainIds,
  requireResourceHubViewer,
} from "~/lib/resource-hub.server";

export const meta: Route.MetaFunction = () => [{ title: "Resource Hub · DALI OS" }];

export const handle = { bleedPane: true };

// Everyone sees published hubs. Drafts show only to who can edit them: their
// creator, the leads of their domain, and Core.
export async function loader({ request }: Route.LoaderArgs) {
  const { user, core } = await requireResourceHubViewer(request);
  const led = core ? [] : await ledDomainIds(user.sub);
  const rows = await prisma.resourceHubPage.findMany({
    where: core
      ? {}
      : {
          OR: [
            { publishedAt: { not: null } },
            { createdById: user.sub },
            ...(led.length ? [{ domainId: { in: led } }] : []),
          ],
        },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, coverUrl: true, bgColor: true, publishedAt: true },
  });
  return {
    cards: rows.map((r) => ({
      id: r.id,
      title: r.title,
      coverUrl: r.coverUrl,
      bgColor: r.bgColor,
      published: r.publishedAt !== null,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireResourceHubViewer(request);
  const form = await request.formData();
  if (form.get("intent") !== "create") throw new Response("Bad request", { status: 400 });

  const [domainId] = await ledDomainIds(user.sub);
  const page = await prisma.resourceHubPage.create({
    data: { createdById: user.sub, domainId: domainId ?? null },
    select: { id: true },
  });
  return redirect(`/resource-hub/${page.id}`);
}

export default function ResourceHubIndex() {
  const { cards } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  return (
    <div className="min-h-dvh bg-card px-6 pb-16 sm:px-10">
      <header className="border-b border-os-container pb-4 pt-8">
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground">
          Resource Hub
        </h1>
      </header>

      <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <li>
          <button
            type="button"
            onClick={() => fetcher.submit({ intent: "create" }, { method: "post" })}
            disabled={fetcher.state !== "idle"}
            aria-label="Add a hub"
            className="group flex h-full min-h-[11rem] w-full flex-col items-center justify-center gap-2 rounded-os-card border border-dashed border-os-container-hi bg-os-hover text-os-grey outline-none transition-[border-color,color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-os-accent/60 disabled:opacity-50"
          >
            <Plus className="h-5 w-5" />
            <span className="text-sm font-medium">Add</span>
          </button>
        </li>
        {cards.map((card) => (
            <li key={card.id}>
              <Link
                to={`/resource-hub/${card.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-os-card border border-os-container bg-os-card outline-none transition-[border-color,transform] duration-150 ease-out hover:border-os-container-hi active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-os-accent/60"
              >
                {isPatternCover(card.coverUrl) ? (
                  <CoverPattern url={card.coverUrl} className="block aspect-[16/10] w-full" />
                ) : (
                  <div
                    className="aspect-[16/10] bg-os-hover bg-cover bg-center"
                    style={{
                      backgroundColor: card.bgColor ?? undefined,
                      backgroundImage: card.coverUrl ? `url(${card.coverUrl})` : undefined,
                    }}
                    aria-hidden
                  />
                )}
                <div className="flex items-center justify-between gap-2 p-4">
                  <h2 className="font-heading text-lg font-semibold text-foreground">
                    {card.title}
                  </h2>
                  {!card.published && <span className="text-xs text-os-grey">Draft</span>}
                </div>
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
