import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { FileText, Link2, ListFilter, MessageSquare, Plus } from "lucide-react";
import type { Route } from "./+types/resource-hub.$pageId.crit";
import { EmptyState } from "~/components/ui/EmptyState";
import { prisma } from "~/lib/db.server";
import { critCommentCounts, loadCritContext, parseSubmissionForm, resolveSubmission, serializeSubmission } from "~/lib/crit.server";
import { parseCritLink } from "~/lib/crit-comments";
import { hydrateAuthors } from "~/lib/collabAuth.server";
import { limitLinkPreviews } from "~/lib/link-preview-limit.server";
import { PageRowControls, type PageRowControl } from "~/components/os-page";
import { CRIT_FILTERS, type CritFilter } from "~/components/resource-hub/crit/filters";
import { ShareWorkModal, type ShareValues } from "~/components/resource-hub/crit/ShareWorkModal";
import { SubmissionOverlay, type CritSubmissionView } from "~/components/resource-hub/crit/SubmissionOverlay";

export const meta: Route.MetaFunction = () => [{ title: "Crit Wall · DALI OS" }];

const person = { select: { firstName: true, lastName: true } };

export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await loadCritContext(request, params.pageId!);
  const rows = await prisma.critSubmission.findMany({
    where: { domainId: ctx.domainId },
    include: { author: person },
    orderBy: { createdAt: "desc" },
  });
  const [counts, [me]] = await Promise.all([critCommentCounts(rows.map((r) => r.id)), hydrateAuthors([ctx.userId])]);
  return {
    viewer: { id: ctx.userId, name: ctx.userName, photoUrl: me?.photoUrl ?? null },
    userName: ctx.userName,
    domainName: ctx.domainName,
    items: rows.map((r) => serializeSubmission(r, ctx.userId, ctx.canModerate, counts.get(r.id) ?? 0)),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const ctx = await loadCritContext(request, params.pageId!);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const parsed = parseSubmissionForm(form);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    if (parsed.value.kind === "link") {
      const limited = limitLinkPreviews(request, ctx.userId);
      if (limited) return limited;
    }
    const { title, previewUrl } = await resolveSubmission(parsed.value);
    const { kind, url, fileName, question, anonymous } = parsed.value;
    await prisma.critSubmission.create({
      data: { domainId: ctx.domainId, authorId: ctx.userId, anonymous, kind, url, fileName, previewUrl, title, question },
    });
    return { ok: true };
  }

  const id = String(form.get("id") ?? "");
  const existing = await prisma.critSubmission.findFirst({ where: { id, domainId: ctx.domainId }, select: { id: true, authorId: true } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  const owner = existing.authorId === ctx.userId;

  if (intent === "edit") {
    if (!owner) return Response.json({ error: "Forbidden" }, { status: 403 });
    const title = String(form.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!title) return Response.json({ error: "Add a title." }, { status: 400 });
    const question = String(form.get("question") ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || null;
    await prisma.critSubmission.update({ where: { id }, data: { title, question } });
    return { ok: true };
  }

  if (intent === "delete") {
    if (!owner && !ctx.canModerate) return Response.json({ error: "Forbidden" }, { status: 403 });
    await prisma.$transaction([
      prisma.docComment.deleteMany({ where: { targetType: "crit", targetId: id } }),
      prisma.critSubmission.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  return Response.json({ error: "Bad request" }, { status: 400 });
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function Thumb({ item }: { item: CritSubmissionView }) {
  const [broken, setBroken] = useState(false);
  const src = item.kind === "image" ? item.url : item.previewUrl;
  if (src && !broken) {
    return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />;
  }
  const Icon = item.kind === "link" ? Link2 : FileText;
  const label = item.kind === "link" ? hostOf(item.url) : (item.fileName?.split(".").pop()?.toUpperCase() ?? "FILE");
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-os-grey">
      <Icon className="h-6 w-6" aria-hidden />
      <span className="max-w-[80%] truncate text-xs">{label}</span>
    </div>
  );
}

export default function CritWall() {
  const { viewer, userName, domainName, items: all } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<CritFilter>("all");
  const active = CRIT_FILTERS.find((f) => f.value === filter)!;
  const items = all.filter(active.keep);
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [sharing, setSharing] = useState(false);
  const { submissionId: openId, threadId } = parseCritLink(params);
  const open = items.find((i) => i.id === openId) ?? null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setSharing(false);
  }, [fetcher.state, fetcher.data]);

  const openItem = (id: string) => setParams({ post: id }, { preventScrollReset: true });
  const closeItem = () =>
    setParams(
      (p) => {
        p.delete("post");
        p.delete("thread");
        return p;
      },
      { replace: true, preventScrollReset: true },
    );

  const share = (v: ShareValues) => {
    const data: Record<string, string> = { intent: "create", kind: v.kind, url: v.url, fileName: v.fileName, title: v.title, question: v.question };
    if (v.anonymous) data.anonymous = "1";
    fetcher.submit(data, { method: "post" });
  };

  const controls: PageRowControl[] = [
    {
      kind: "menu",
      key: "filter",
      label: active.label,
      icon: ListFilter,
      items: CRIT_FILTERS.map((f) => ({ key: f.value, label: f.label, onSelect: () => setFilter(f.value) })),
    },
    { key: "share", label: "Share work", icon: Plus, primary: true, onClick: () => setSharing(true) },
  ];

  return (
    <div className="pb-[40vh]">
      <PageRowControls controls={controls} />
      <p className="mb-6 text-sm text-os-grey">Share what you're working on and get feedback from your domain{domainName ? ` (${domainName})` : ""}.</p>

      {items.length === 0 ? (
        <EmptyState title="Nothing here yet">
          {all.length === 0 ? "Be the first to share something you're working on." : "No work matches this filter."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => {
            const external = item.kind === "link";
            const body = (
              <>
                <span className="block aspect-[4/3] overflow-hidden rounded-xl border border-os-container bg-os-bg transition-[border-color,transform] duration-150 group-hover:border-os-container-hi motion-reduce:transition-none">
                  <Thumb item={item} />
                </span>
                <span className="mt-3 block truncate text-sm font-medium text-foreground">{item.title}</span>
                <span className="block truncate text-xs text-os-grey">{item.anonymous ? "Anonymous" : item.authorName}</span>
                {item.question && <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{item.question}</span>}
              </>
            );
            return (
              <li key={item.id} className="group relative">
                {external ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60">
                    {body}
                  </a>
                ) : (
                  <button type="button" onClick={() => openItem(item.id)} className="block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60">
                    {body}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openItem(item.id)}
                  aria-label={`${item.commentCount} comments on ${item.title}`}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-md py-0.5 text-xs text-os-grey transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60"
                >
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                  {item.commentCount}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {sharing && (
        <ShareWorkModal
          userName={userName}
          busy={fetcher.state !== "idle"}
          serverError={fetcher.data?.error ?? null}
          onClose={() => setSharing(false)}
          onSubmit={share}
        />
      )}
      {open && (
        <SubmissionOverlay
          viewer={viewer}
          initialThreadId={threadId}
          submission={open}
          onClose={closeItem}
          onChanged={() => revalidator.revalidate()}
          onEdit={(title, question) => fetcher.submit({ intent: "edit", id: open.id, title, question }, { method: "post" })}
          onDelete={() => {
            fetcher.submit({ intent: "delete", id: open.id }, { method: "post" });
            closeItem();
          }}
        />
      )}
    </div>
  );
}
