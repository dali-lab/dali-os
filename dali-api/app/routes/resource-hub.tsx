import { isPatternCover } from "~/components/cover/CoverPattern";
import { HubCard } from "~/components/resource-hub/HubCard";
import { HubCoverStudio } from "~/components/resource-hub/HubCoverStudio";
import { useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { Plus } from "lucide-react";
import type { Route } from "./+types/resource-hub";
import { prisma } from "~/lib/db.server";
import { hubDomainOptions, ledDomainIds, requireResourceHubViewer } from "~/lib/resource-hub.server";

export const meta: Route.MetaFunction = () => [{ title: "Resource Hub · DALI OS" }];

export const handle = { bleedPane: true };

const HUB_EXISTS = "That domain already has a hub.";

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
    select: { id: true, title: true, coverUrl: true, publishedAt: true },
  });
  return {
    domains: await hubDomainOptions(user.sub, core),
    cards: rows.map((r) => ({
      id: r.id,
      title: r.title,
      coverUrl: r.coverUrl,
      published: r.publishedAt !== null,
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { user, core } = await requireResourceHubViewer(request);
  const form = await request.formData();
  if (form.get("intent") !== "create") throw new Response("Bad request", { status: 400 });

  const domainId = String(form.get("domainId") ?? "");
  if (!domainId) return Response.json({ error: "Pick a domain." }, { status: 400 });
  const option = (await hubDomainOptions(user.sub, core)).find((d) => d.id === domainId);
  if (!option) return Response.json({ error: "You can't create a hub for that domain." }, { status: 403 });
  if (option.taken) return Response.json({ error: HUB_EXISTS }, { status: 409 });
  const title = String(form.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const cover = String(form.get("cover") ?? "");
  if (cover && !isPatternCover(cover)) throw new Response("Bad request", { status: 400 });
  let page;
  try {
    page = await prisma.resourceHubPage.create({
      data: {
        createdById: user.sub,
        domainId,
        ...(title ? { title } : null),
        ...(cover ? { coverUrl: cover } : null),
      },
      select: { id: true },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return Response.json({ error: HUB_EXISTS }, { status: 409 });
    throw e;
  }
  return redirect(`/resource-hub/${page.id}`);
}

export default function ResourceHubIndex() {
  const { cards, domains } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string }>();
  const [studio, setStudio] = useState(false);
  const [staleResult, setStaleResult] = useState<unknown>(null);
  const openStudio = () => {
    setStaleResult(fetcher.data);
    setStudio(true);
  };

  return (
    <div className="min-h-dvh bg-card px-6 pb-16 sm:px-10">
      <header className="border-b border-os-container pb-4 pt-8">
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground">
          Resource Hub
        </h1>
      </header>

      {studio && (
        <HubCoverStudio
          busy={fetcher.state !== "idle"}
          heading="Design the banner"
          submitLabel="Create and edit"
          initialTitle=""
          initialCover={null}
          onClose={() => setStudio(false)}
          domainOptions={domains.map((d) => ({ value: d.id, label: d.name, disabled: d.taken, description: d.taken ? "Has a hub" : undefined }))}
          serverError={fetcher.data === staleResult ? null : (fetcher.data?.error ?? null)}
          onSubmit={(title, cover, domainId) => fetcher.submit({ intent: "create", title, cover, domainId: domainId ?? "" }, { method: "post" })}
        />
      )}

      <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <button
            type="button"
            onClick={openStudio}
            disabled={fetcher.state !== "idle"}
            aria-label="Add a hub"
            className="group flex h-full min-h-[13rem] w-full flex-col items-center justify-center gap-2 rounded-os-card border border-dashed border-os-container-hi bg-os-hover text-os-grey outline-none transition-[border-color,color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-os-accent/60 disabled:opacity-50"
          >
            <Plus className="h-5 w-5" />
            <span className="text-sm font-medium">Add</span>
          </button>
        </li>
        {cards.map((card) => (
          <li key={card.id}>
            <HubCard cover={card.coverUrl} title={card.title} href={`/resource-hub/${card.id}`} draft={!card.published} />
          </li>
        ))}
      </ul>
    </div>
  );
}
