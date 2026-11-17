import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import type { Route } from "./+types/resource-hub.$pageId.references";
import { EmptyState } from "~/components/ui/EmptyState";
import { prisma } from "~/lib/db.server";
import { loadReferencesByIds, loadReferencesContext, loadReferencesPage, parseReferenceEdit, parseReferenceForm, resolveReference } from "~/lib/references.server";
import { limitLinkPreviews } from "~/lib/link-preview-limit.server";
import { PageRowControls } from "~/components/os-page";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { LoadMore } from "~/components/ui/Pager";
import { fetchCursorPage } from "~/hooks/useLoadMore";
import { useRefreshedLoadMore } from "~/hooks/useRefreshedLoadMore";
import { ReferenceModal, type ReferenceValues } from "~/components/resource-hub/references/ReferenceModal";
import type { ReferenceView } from "~/lib/references.server";
import { ReferenceCard } from "~/components/resource-hub/references/ReferenceCard";
import { ReferenceOverlay } from "~/components/resource-hub/references/ReferenceOverlay";

export const meta: Route.MetaFunction = () => [{ title: "References · DALI OS" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const ctx = await loadReferencesContext(request, params.pageId!);
  const referenceId = new URL(request.url).searchParams.get("r");
  const page = await loadReferencesPage(ctx, null);
  const linked =
    referenceId && !page.items.some((i) => i.id === referenceId) ? ((await loadReferencesByIds(ctx, [referenceId]))[0] ?? null) : null;
  return { pageId: params.pageId!, items: page.items, nextCursor: page.nextCursor, linked };
}

export async function action({ request, params }: Route.ActionArgs) {
  const ctx = await loadReferencesContext(request, params.pageId!);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const parsed = parseReferenceForm(form);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    if (parsed.value.kind === "link") {
      const limited = limitLinkPreviews(request, ctx.userId);
      if (limited) return limited;
    }
    const { title, previewUrl } = await resolveReference(parsed.value);
    const { kind, url, fileName, creatorName, daliMade, note } = parsed.value;
    await prisma.domainReference.create({
      data: { domainId: ctx.domainId, authorId: ctx.userId, kind, url, fileName, previewUrl, title, creatorName, daliMade, note },
    });
    return { ok: true };
  }

  const id = String(form.get("id") ?? "");
  const existing = await prisma.domainReference.findFirst({ where: { id, domainId: ctx.domainId }, select: { id: true, authorId: true } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  const owner = existing.authorId === ctx.userId;

  if (intent === "edit") {
    if (!owner) return Response.json({ error: "Forbidden" }, { status: 403 });
    const parsed = parseReferenceEdit(form);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    await prisma.domainReference.update({ where: { id }, data: parsed.value });
    return { ok: true };
  }

  if (intent === "delete") {
    if (!owner && !ctx.canModerate) return Response.json({ error: "Forbidden" }, { status: 403 });
    await prisma.domainReference.delete({ where: { id } });
    return { ok: true };
  }

  return Response.json({ error: "Bad request" }, { status: 400 });
}

export default function References() {
  const { pageId, items: firstPage, nextCursor, linked } = useLoaderData<typeof loader>();
  const apiUrl = `/api/resource-hub/${pageId}/references`;
  const { items, pager } = useRefreshedLoadMore<ReferenceView>({
    items: firstPage,
    nextCursor,
    fetchPage: (cursor) => fetchCursorPage<ReferenceView>(`${apiUrl}?cursor=${encodeURIComponent(cursor)}`),
    fetchByIds: async (ids) => (await fetchCursorPage<ReferenceView>(`${apiUrl}?ids=${ids.join(",")}`)).items,
  });
  const [params, setParams] = useSearchParams();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const deleteFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const toast = useToast();
  const dialog = useDialog();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openId = params.get("r");
  const open = items.find((i) => i.id === openId) ?? (linked?.id === openId ? linked : null);
  const editing = items.find((i) => i.id === editingId) ?? null;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) closeForm();
    else setError(fetcher.data.error ?? "Something went wrong.");
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data && !deleteFetcher.data.ok) {
      toast.error(deleteFetcher.data.error ?? "Couldn't delete this reference.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  const openItem = (id: string) => setParams({ r: id }, { preventScrollReset: true });
  const closeItem = () =>
    setParams(
      (p) => {
        p.delete("r");
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
  const showForm = (id: string | null) => {
    setError(null);
    setEditingId(id);
    setAdding(id === null);
  };
  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
  };

  const submit = (v: ReferenceValues) => {
    const data: Record<string, string> = { intent: editing ? "edit" : "create", title: v.title, creator: v.creator, creatorName: v.creatorName, note: v.note };
    if (editing) data.id = editing.id;
    else Object.assign(data, { kind: v.kind, url: v.url, fileName: v.fileName });
    fetcher.submit(data, { method: "post" });
  };

  const remove = async (id: string) => {
    if (await dialog.confirm({ title: "Delete this reference?", confirmLabel: "Delete", tone: "destructive" })) {
      deleteFetcher.submit({ intent: "delete", id }, { method: "post" });
    }
  };

  return (
    <div className="pb-[40vh]">
      <PageRowControls controls={[{ key: "add", label: "Add reference", icon: Plus, primary: true, onClick: () => showForm(null) }]} />
      <p className="mb-6 text-sm text-os-grey">A collection of work and inspiration shared by the domain.</p>

      {items.length === 0 ? (
        <EmptyState title="Nothing here yet">Add the first reference.</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-9 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <ReferenceCard key={item.id} item={item} onOpen={() => openItem(item.id)} onEdit={() => showForm(item.id)} onDelete={() => void remove(item.id)} />
          ))}
        </ul>
      )}
      <LoadMore {...pager} />

      {(adding || editing) && (
        <ReferenceModal
          key={editing?.id ?? "new"}
          reference={editing ?? undefined}
          busy={fetcher.state !== "idle"}
          serverError={error}
          onClose={closeForm}
          onSubmit={submit}
        />
      )}
      {open && <ReferenceOverlay item={open} onClose={closeItem} />}
    </div>
  );
}
