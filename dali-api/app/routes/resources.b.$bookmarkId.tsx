import { useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { Check, Pencil, TextCursorInput, Trash2 } from "lucide-react";
import type { Route } from "./+types/resources.b.$bookmarkId";
import { DocEditor } from "~/components/doc";
import { resourcesRoomName } from "~/collab/roomName";
import { prisma } from "~/lib/db";
import { cn } from "~/lib/cn";
import { getCollabToken } from "~/lib/collab-token.server";
import { requireResourcesViewer } from "~/lib/resources.server";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";

// A bookmark's page. Every lab member reads it; Core/Admin write. The socket
// enforces the same split (collabAuth's `resources` branch) — `canEdit` here
// only decides whether the controls appear.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, core, userName } = await requireResourcesViewer(request);
  const bookmark = await prisma.resourceBookmark.findUnique({
    where: { id: params.bookmarkId },
    select: { id: true, title: true },
  });
  if (!bookmark) throw new Response("Not found", { status: 404 });
  return {
    bookmark,
    canEdit: core,
    collabToken: await getCollabToken(request),
    currentUserId: user.sub,
    userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { core } = await requireResourcesViewer(request);
  if (!core) throw new Response("Forbidden", { status: 403 });
  const id = params.bookmarkId!;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "rename") {
    const title = String(form.get("title") ?? "").trim();
    if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
    await prisma.resourceBookmark.update({ where: { id }, data: { title } });
    return { ok: true };
  }

  if (intent === "delete") {
    await prisma.$transaction([
      prisma.collabDocument.deleteMany({ where: { name: resourcesRoomName(id) } }),
      prisma.resourceBookmark.delete({ where: { id } }),
    ]);
    return redirect("/resources");
  }

  throw new Response("Bad request", { status: 400 });
}

export default function ResourceBookmarkPage() {
  const { bookmark, canEdit, collabToken, currentUserId, userName } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const dialog = useDialog();
  // Read mode by default, for Core too: this is the page the whole lab opens to
  // look something up, so a stray keystroke should not change it. Toggling the
  // prop is safe mid-session — BlockNote remounts the view, not the collab doc.
  const [editing, setEditing] = useState(false);

  async function rename() {
    const title = await dialog.prompt({
      title: "Rename bookmark",
      label: "Name",
      defaultValue: bookmark.title,
    });
    if (title?.trim()) fetcher.submit({ intent: "rename", title }, { method: "post" });
  }

  async function remove() {
    const ok = await dialog.confirm({
      title: `Delete ${bookmark.title}?`,
      description: "The page and its content are removed for everyone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "delete" }, { method: "post" });
  }

  if (!collabToken) {
    return (
      <p className="py-8 text-sm italic text-muted-foreground">Sign in again to open Resources.</p>
    );
  }

  return (
    <div>
      {/* Always rendered: with no buttons in it the row is the page's top
          gutter, which a read-only viewer needs anyway. */}
      <div className="sticky top-0 z-20 flex items-center justify-end gap-1 bg-card py-4">
        {canEdit && (
          <>
            <IconButton label="Rename" icon={TextCursorInput} onClick={rename} />
            <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={remove} />
            <button
              type="button"
              onClick={() => setEditing((on) => !on)}
              aria-pressed={editing}
              className="os-btn-primary os-btn-primary--sm ml-2"
            >
              {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {editing ? "Done" : "Edit"}
            </button>
          </>
        )}
      </div>
      <DocEditor
        key={bookmark.id}
        features="resource"
        editable={canEdit && editing}
        collab={{
          documentName: resourcesRoomName(bookmark.id),
          token: collabToken,
          userName,
          userId: currentUserId,
        }}
        placeholder="Write something, or press '/' for commands"
        // The editor keeps a 54px gutter each side for its block handles. Reading,
        // that is dead space, so drop it; editing, let the handles sit in the
        // page's own padding instead of pushing the text in.
        className={cn(
          "min-h-[70vh]",
          canEdit && editing ? "sm:-mx-10" : "[&_.bn-editor]:!px-0",
        )}
      />
    </div>
  );
}
