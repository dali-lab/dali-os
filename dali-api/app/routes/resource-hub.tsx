import {
  COVER_DECOR,
  COVER_PATTERNS,
  CoverPattern,
  buildCoverUrl,
  coverGround,
  isPatternCover,
  parseCover,
} from "~/components/resource-hub/CoverPattern";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Plus } from "lucide-react";
import type { Route } from "./+types/resource-hub";
import { prisma } from "~/lib/db.server";
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
  const title = String(form.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const cover = String(form.get("cover") ?? "");
  if (cover && !isPatternCover(cover)) throw new Response("Bad request", { status: 400 });
  const page = await prisma.resourceHubPage.create({
    data: {
      createdById: user.sub,
      domainId: domainId ?? null,
      ...(title ? { title } : null),
      ...(cover ? { coverUrl: cover } : null),
    },
    select: { id: true },
  });
  return redirect(`/resource-hub/${page.id}`);
}

function CoverStudio({ open, busy, onClose, onCreate }: { open: boolean; busy: boolean; onClose: () => void; onCreate: (title: string, cover: string) => void }) {
  const [title, setTitle] = useState("");
  const [cover, setCover] = useState(buildCoverUrl(COVER_PATTERNS[0]!.id));
  const parsed = parseCover(cover)!;
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="cover-studio-title"
      disableEscape={busy}
      containerClassName="w-full max-w-2xl rounded-os-card bg-os-card p-6 shadow-xl"
    >
      <ModalHeader titleId="cover-studio-title" title="Design the banner" subtitle="Pick a style and name your hub. You can change both later." onClose={onClose} />
      <div className="overflow-hidden rounded-os-item border border-os-container">
        <CoverPattern url={cover} title={title || "Untitled hub"} />
      </div>
      <label className="mt-4 flex flex-col gap-1.5 text-sm text-os-grey">
        Title
        <input
          autoFocus
          value={title}
          maxLength={120}
          placeholder="e.g. Design"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && onCreate(title, cover)}
          className="h-9 rounded-lg border border-os-container-hi bg-os-bg px-3 text-sm text-foreground outline-none focus:border-os-accent focus:ring-2 focus:ring-os-accent/25"
        />
      </label>
      <p className="mb-2 mt-4 text-sm font-semibold text-foreground">Style</p>
      <div className="grid grid-cols-3 gap-3">
        {COVER_PATTERNS.map((pt) => {
          const selected = parsed.id === pt.id;
          return (
            <button
              key={pt.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setCover(buildCoverUrl(pt.id, parsed.decor))}
              className="group/thumb flex flex-col gap-1 text-left focus-visible:outline-none"
            >
              <span className={`block overflow-hidden rounded-lg border transition-shadow group-hover/thumb:shadow-md group-focus-visible/thumb:ring-2 group-focus-visible/thumb:ring-os-accent/60 ${selected ? "border-os-accent ring-1 ring-os-accent" : "border-os-container"}`}>
                <CoverPattern url={buildCoverUrl(pt.id, parsed.decor)} title={title || "Untitled hub"} />
              </span>
              <span className="text-xs text-os-grey">{pt.name}</span>
            </button>
          );
        })}
      </div>
      <p className="mb-2 mt-4 text-sm font-semibold text-foreground">Decor</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Decor">
        {COVER_DECOR.map((d) => {
          const on = parsed.decor.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              aria-pressed={on}
              onClick={() => setCover(buildCoverUrl(parsed.id, on ? parsed.decor.filter((x) => x !== d.id) : [...parsed.decor, d.id]))}
              className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60 ${on ? "border-os-accent bg-os-accent/10 text-foreground" : "border-os-container text-os-grey hover:bg-os-hover hover:text-foreground"}`}
            >
              {d.name}
            </button>
          );
        })}
      </div>
      <ModalFooter onCancel={onClose} cancelDisabled={busy}>
        <button type="button" disabled={busy} onClick={() => onCreate(title, cover)} className="os-btn-primary os-btn-primary--sm !text-white">
          Create and edit
        </button>
      </ModalFooter>
    </Modal>
  );
}

export default function ResourceHubIndex() {
  const { cards } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [studio, setStudio] = useState(false);

  return (
    <div className="min-h-dvh bg-card px-6 pb-16 sm:px-10">
      <header className="border-b border-os-container pb-4 pt-8">
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-foreground">
          Resource Hub
        </h1>
      </header>

      <CoverStudio
        open={studio}
        busy={fetcher.state !== "idle"}
        onClose={() => setStudio(false)}
        onCreate={(title, cover) => fetcher.submit({ intent: "create", title, cover }, { method: "post" })}
      />

      <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <li>
          <button
            type="button"
            onClick={() => setStudio(true)}
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
                aria-label={card.title}
                className="group flex h-full flex-col overflow-hidden rounded-os-card border border-os-container bg-os-card outline-none transition-[border-color,transform] duration-150 ease-out hover:border-os-container-hi active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-os-accent/60"
              >
                {isPatternCover(card.coverUrl) ? (
                  <div className="relative grid aspect-[16/10] place-items-center" style={{ background: coverGround(card.coverUrl) }}>
                    <CoverPattern url={card.coverUrl} title={card.title} />
                    {!card.published && (
                      <span className="absolute right-2 top-2 rounded-full bg-os-bg/85 px-2 py-0.5 text-xs text-os-grey backdrop-blur">Draft</span>
                    )}
                  </div>
                ) : (
                  <div
                    className="aspect-[16/10] bg-os-hover bg-cover bg-center"
                    style={{
                      backgroundColor: card.bgColor ?? undefined,
                      backgroundImage: card.coverUrl ? `url(${card.coverUrl})` : undefined,
                    }}
                    aria-hidden
                  >
                    {!card.published && (
                      <span className="m-2 ml-auto block w-fit rounded-full bg-os-bg/85 px-2 py-0.5 text-xs text-os-grey backdrop-blur">Draft</span>
                    )}
                  </div>
                )}
              </Link>
            </li>
          ))}
      </ul>
    </div>
  );
}
