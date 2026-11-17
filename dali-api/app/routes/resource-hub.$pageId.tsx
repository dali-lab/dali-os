import { useEffect, useRef, useState } from "react";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { Cloud, Eye, EyeOff, Trash2, Upload } from "lucide-react";
import type { Route } from "./+types/resource-hub.$pageId";
import {
  DocEditor,
  type DocEditorInstance,
  type DocSyncState,
} from "~/components/doc";
import { prisma } from "~/lib/db.server";
import { resourceHubRoomName } from "~/collab/roomName";
import { getCollabToken } from "~/lib/collab-token.server";
import { isAiEnabled } from "~/lib/ai.server";
import { loadHubShell } from "~/lib/resource-hub.server";
import { PageRowControls, type PageRowControl } from "~/components/os-page";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Resource Hub"} · DALI OS` },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { viewer, page, canEdit } = await loadHubShell(request, params.pageId!);
  const content = await prisma.resourceHubPage.findUnique({ where: { id: page.id }, select: { contentJson: true } });
  return {
    page: {
      id: page.id,
      title: page.title,
      published: page.publishedAt !== null,
      contentJson: content?.contentJson ?? null,
    },
    canEdit,
    aiEnabled: isAiEnabled(),
    collabToken: canEdit ? await getCollabToken(request) : null,
    currentUserId: viewer.user.sub,
    userName: viewer.userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { page, canEdit } = await loadHubShell(request, params.pageId!);
  if (!canEdit) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const where = { id: page.id };

  switch (form.get("intent")) {
    case "publish":
      await prisma.resourceHubPage.update({
        where,
        data: { publishedAt: form.get("published") === "1" ? new Date() : null },
      });
      return { ok: true };
    case "delete":
      await prisma.$transaction([
        prisma.collabDocument.deleteMany({ where: { name: resourceHubRoomName(page.id) } }),
        prisma.resourceHubPage.delete({ where }),
      ]);
      return redirect("/resource-hub");
    default:
      throw new Response("Bad request", { status: 400 });
  }
}

const SYNC_LABEL: Record<DocSyncState, string> = {
  saving: "Saving",
  saved: "Saved",
  offline: "Offline",
};

export default function ResourceHubPage() {
  const { page, canEdit, aiEnabled, collabToken, currentUserId, userName } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const dialog = useDialog();
  const toast = useToast();
  const [sync, setSync] = useState<DocSyncState>("saved");
  const [editor, setEditor] = useState<DocEditorInstance | null>(null);
  const [preview, setPreview] = useState(false);
  // Blocks as they stood when Preview was pressed, read before the live editor unmounts.
  const [snapshot, setSnapshot] = useState<unknown[] | null>(null);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok) toast.success("Hub published. Changes now show to members as you edit.");
    else toast.error("Couldn't publish. Try again.");
  }, [fetcher.state, fetcher.data, toast]);
  const live = canEdit && !!collabToken;
  const editing = live && !preview;

  async function remove() {
    const ok = await dialog.confirm({
      title: "Delete this hub?",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) submit({ intent: "delete" });
  }

  const controls: PageRowControl[] = live
    ? [
        ...(preview
          ? []
          : [{ kind: "custom" as const, key: "sync", label: SYNC_LABEL[sync], icon: Cloud, render: () => <span className="px-2 text-[13px] text-os-grey">{SYNC_LABEL[sync]}</span> }]),
        {
          key: "preview",
          label: preview ? "Back to editing" : "Preview",
          icon: preview ? EyeOff : Eye,
          pressed: preview,
          onClick: () => {
            if (!preview && editor) setSnapshot(editor.document as unknown[]);
            setPreview((on) => !on);
          },
        },
        { key: "delete", label: "Delete", icon: Trash2, onClick: () => void remove() },
        ...(page.published
          ? []
          : [
              {
                key: "publish",
                label: "Publish",
                icon: Upload,
                primary: true,
                disabled: fetcher.state !== "idle",
                onClick: () => submit({ intent: "publish", published: "1" }),
              },
            ]),
      ]
    : [];

  // Clicking the empty space under the content puts the cursor on a fresh line
  // right after the last block (or the last line, if it's already empty).
  function focusEnd(e: React.MouseEvent) {
    if (!editing || !editor) return;
    if ((e.target as Element).closest(".bn-editor, button, a, input, textarea, [role=menu], [role=dialog]")) return;
    const blocks = editor.document;
    const last = blocks[blocks.length - 1];
    if (!last) return;
    const empty = last.type === "paragraph" && Array.isArray(last.content) && last.content.length === 0;
    if (empty) {
      editor.setTextCursorPosition(last, "end");
    } else {
      const [added] = editor.insertBlocks([{ type: "paragraph" }], last, "after");
      if (added) editor.setTextCursorPosition(added, "start");
    }
    editor.focus();
  }

  return (
    <div onClick={focusEnd} className={`flex-1 ${editing ? "pb-[55vh]" : ""}`}>
      <PageRowControls controls={controls} />
      {editing ? (
        <DocEditor
          key={page.id}
          features="resource"
          aiEnabled={aiEnabled}
          collab={{
            documentName: resourceHubRoomName(page.id),
            token: collabToken,
            userName,
            userId: currentUserId,
          }}
          onSyncStateChange={setSync}
          onEditorReady={setEditor}
          placeholder="Press '/' for blocks"
          className="min-h-[70vh]"
        />
      ) : (
        <DocEditor
          key={`${page.id}-read`}
          features="resource"
          editable={false}
          className="min-h-[70vh] [&_.bn-editor]:!px-0"
          initialContent={((preview && snapshot) || page.contentJson || []) as never}
        />
      )}
    </div>
  );
}
