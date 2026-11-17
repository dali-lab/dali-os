import { useEffect, useRef, useState } from "react";
import { redirect, useFetcher, useLoaderData, useNavigate, useOutletContext } from "react-router";
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
import type { HubOutletContext } from "~/components/resource-hub/hub-tabs";
import { useDialog } from "~/components/ui/dialog";
import { Modal, ModalHeader } from "~/components/Modal";
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
  const { leaveGuard } = useOutletContext<HubOutletContext>();
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const navigate = useNavigate();
  const [leave, setLeave] = useState<"closed" | "asking" | "publishing">("closed");
  const dialog = useDialog();
  const toast = useToast();
  const [sync, setSync] = useState<DocSyncState>("saved");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (sync === "saving") setDirty(true);
  }, [sync]);
  const [editor, setEditor] = useState<DocEditorInstance | null>(null);
  const [preview, setPreview] = useState(false);
  // Blocks as they stood when Preview was pressed, read before the live editor unmounts.
  const [snapshot, setSnapshot] = useState<unknown[] | null>(null);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });
  useEffect(() => {
    if (leave !== "publishing" || fetcher.state !== "idle") return;
    if (fetcher.data?.ok) navigate("/resource-hub");
    else {
      setLeave("asking");
      toast.error("Couldn't publish. Try again.");
    }
  }, [leave, fetcher.state, fetcher.data, navigate, toast]);
  const live = canEdit && !!collabToken;
  const editing = live && !preview;

  useEffect(() => {
    leaveGuard.current = () => {
      if (!live || (page.published && !dirty)) return false;
      setLeave("asking");
      return true;
    };
    return () => {
      leaveGuard.current = null;
    };
  }, [leaveGuard, live, page.published, dirty]);

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
        {
          key: "publish",
          label: page.published ? "Update" : "Publish",
          icon: Upload,
          primary: true,
          disabled: fetcher.state !== "idle",
          onClick: () => {
            submit({ intent: "publish", published: "1" });
            if (page.published) toast.success("Hub updated.");
          },
        },
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
      <Modal
        open={leave !== "closed"}
        onClose={() => leave === "asking" && setLeave("closed")}
        labelledBy="leave-hub-title"
        disableEscape={leave === "publishing"}
        containerClassName="w-full max-w-sm rounded-os-card bg-os-card p-6 shadow-xl"
      >
        <ModalHeader
          titleId="leave-hub-title"
          title={page.published ? "Update this hub?" : "Publish this hub?"}
          subtitle={page.published ? "Your changes are already saved. Updating marks the hub as updated for members." : "Members can see it once it's published. Otherwise it stays a draft that only you and editors can open."}
          onClose={() => setLeave("closed")}
          hideClose={leave === "publishing"}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={leave === "publishing"}
            onClick={() => navigate("/resource-hub")}
            className="os-btn-ghost disabled:cursor-not-allowed disabled:opacity-60"
          >
            {page.published ? "No, leave as is" : "No, save as draft"}
          </button>
          <button
            type="button"
            disabled={leave === "publishing"}
            onClick={() => {
              setLeave("publishing");
              submit({ intent: "publish", published: "1" });
            }}
            className="os-btn-primary os-btn-primary--sm"
          >
            {page.published ? "Update" : "Publish"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
