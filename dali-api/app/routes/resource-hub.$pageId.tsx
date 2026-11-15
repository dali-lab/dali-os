import { useEffect, useRef, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { ArrowLeft, Eye, EyeOff, ImagePlus, Trash2 } from "lucide-react";
import type { Route } from "./+types/resource-hub.$pageId";
import {
  DocEditor,
  uploadEditorImage,
  type DocEditorInstance,
  type DocSyncState,
} from "~/components/doc";
import { prisma } from "~/lib/db.server";
import { resourceHubRoomName } from "~/collab/roomName";
import { getCollabToken } from "~/lib/collab-token.server";
import { isAiEnabled } from "~/lib/ai.server";
import { canEditResourceHub, requireResourceHubViewer } from "~/lib/resource-hub.server";
import { IconButton } from "~/components/ui/IconButton";
import { InlineTitle, cardColorHex, isPatternCover, parseCover } from "~/components/resource-hub/CoverPattern";
import { HubCard } from "~/components/resource-hub/HubCard";
import { CoverStudio } from "~/components/resource-hub/CoverStudio";
import { ResourceHubTabs } from "~/components/resource-hub/ResourceHubTabs";
import { useDialog } from "~/components/ui/dialog";
import { Modal, ModalHeader } from "~/components/Modal";
import { useToast } from "~/components/ui/toast";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Resource Hub"} · DALI OS` },
];

export const handle = { bleedPane: true };

async function loadPage(request: Request, pageId: string) {
  const viewer = await requireResourceHubViewer(request);
  const page = await prisma.resourceHubPage.findUnique({ where: { id: pageId } });
  if (!page) {
    // Links from the one-page-per-domain draft used the domain code.
    const old = await prisma.resourceHubPage.findFirst({
      where: { domain: { code: pageId } },
      select: { id: true },
    });
    if (old) throw redirect(`/resource-hub/${old.id}`);
    throw new Response("Not found", { status: 404 });
  }
  const canEdit = await canEditResourceHub(viewer.user.sub, page);
  // A draft doesn't exist for anyone who can't edit it.
  if (!page.publishedAt && !canEdit) throw new Response("Not found", { status: 404 });
  return { viewer, page, canEdit };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { viewer, page, canEdit } = await loadPage(request, params.pageId!);
  return {
    page: {
      id: page.id,
      title: page.title,
      coverUrl: page.coverUrl,
      published: page.publishedAt !== null,
      hasDomain: page.domainId !== null,
      contentJson: page.contentJson,
    },
    canEdit,
    aiEnabled: isAiEnabled(),
    collabToken: canEdit ? await getCollabToken(request) : null,
    currentUserId: viewer.user.sub,
    userName: viewer.userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { page, canEdit } = await loadPage(request, params.pageId!);
  if (!canEdit) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const where = { id: page.id };

  switch (form.get("intent")) {
    case "title": {
      const title = String(form.get("title") ?? "").trim();
      if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
      await prisma.resourceHubPage.update({ where, data: { title } });
      return { ok: true };
    }
    case "cover": {
      const url = String(form.get("url") ?? "");
      // Only the app's own upload redirect, never an arbitrary URL.
      if (url && !isPatternCover(url) && !url.startsWith("/api/upload/raw?key=uploads%2F")) {
        return Response.json({ error: "Invalid image" }, { status: 400 });
      }
      await prisma.resourceHubPage.update({ where, data: { coverUrl: url || null } });
      return { ok: true };
    }
    case "banner": {
      const title = String(form.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      const url = String(form.get("url") ?? "");
      if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
      if (url && !isPatternCover(url) && !url.startsWith("/api/upload/raw?key=uploads%2F")) {
        return Response.json({ error: "Invalid image" }, { status: 400 });
      }
      await prisma.resourceHubPage.update({ where, data: { title, coverUrl: url || null } });
      return { ok: true };
    }
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
  const [studio, setStudio] = useState(false);
  const [titleDraft, setTitleDraft] = useState(page.title);

  useEffect(() => setTitleDraft(page.title), [page.title]);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });
  useEffect(() => {
    if (leave !== "publishing" || fetcher.state !== "idle") return;
    if (fetcher.data?.ok) navigate("/resource-hub");
    else {
      setLeave("asking");
      toast.error("Couldn't publish. Try again.");
    }
  }, [leave, fetcher.state, fetcher.data, navigate, toast]);
  const commitTitle = (next: string) => {
    if (next && next !== page.title) submit({ intent: "title", title: next });
    else setTitleDraft(page.title);
  };
  const patternCover = isPatternCover(page.coverUrl);
  const hasCover = !patternCover && (!!page.coverUrl || (canEdit && !!collabToken && !preview));
  const pill = patternCover ? "rounded-full bg-[var(--os-on-art-chip)] px-2.5 py-1 text-[var(--os-on-art-ink)] [&_button:not(.os-btn-primary)]:text-[var(--os-on-art-ink)] [&_button:not(.os-btn-primary)]:border-[var(--os-on-art-line)] [&_button:not(.os-btn-primary):hover]:bg-[var(--os-on-art-chip-hover)] [&_svg]:text-[var(--os-on-art-ink)]" : hasCover ? "rounded-full bg-[var(--os-on-art-chip)] px-2.5 py-1 text-[var(--os-on-art-ink)] backdrop-blur [&_button:not(.os-btn-primary)]:text-[var(--os-on-art-ink)] [&_button:not(.os-btn-primary)]:border-[var(--os-on-art-line)] [&_button:not(.os-btn-primary):hover]:bg-[var(--os-on-art-chip-hover)] [&_svg]:text-[var(--os-on-art-ink)]" : "";
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
    <div
      onClick={focusEnd}
      className={`min-h-dvh bg-card px-6 sm:px-10 ${editing ? "pb-[55vh]" : "pb-16"}`}
    >
      <div
        className={patternCover ? "relative -mx-6 mb-6 text-[var(--os-on-art-ink)] sm:-mx-10" : "relative"}
        style={patternCover ? { backgroundColor: cardColorHex(parseCover(page.coverUrl)?.card) } : undefined}
      >
      <div
        className={
          patternCover
            ? "grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-4 pl-9 pr-6 sm:pl-[94px] sm:pr-10"
            : hasCover
            ? "absolute -left-6 -right-6 top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-4 sm:-left-10 sm:-right-10 sm:px-10"
            : "-mx-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 bg-os-bg px-6 py-4 sm:-mx-10 sm:px-10"
        }
      >
        <div className="flex items-center gap-2 justify-self-start">
          <Link
            to="/resource-hub"
            onClick={(e) => {
              if (live && (!page.published || dirty)) {
                e.preventDefault();
                setLeave("asking");
              }
            }}
            className={`inline-flex items-center gap-1.5 text-sm ${hasCover ? "text-[var(--os-on-art-ink)] opacity-85 hover:opacity-100" : "text-os-grey hover:text-foreground"} ${pill}`}
          >
            <ArrowLeft className="h-4 w-4" />
            Resource Hub
          </Link>
        </div>
        <span className={`text-sm ${hasCover ? "text-[var(--os-on-art-ink)] opacity-85" : "text-os-grey"} ${live && !preview ? pill : ""}`}>{live && !preview ? SYNC_LABEL[sync] : ""}</span>
        {live ? (
          <div className={`flex items-center gap-2 justify-self-end ${pill}`}>
            <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={remove} />
            <IconButton
              label={preview ? "Back to editing" : "Preview"}
              icon={preview ? EyeOff : Eye}
              aria-pressed={preview}
              className="h-8 w-8 border border-os-container-hi"
              onClick={() => {
                if (!preview && editor) setSnapshot(editor.document as unknown[]);
                setPreview((on) => !on);
              }}
            />
            <button
              type="button"
              disabled={fetcher.state !== "idle"}
              onClick={() => {
                submit({ intent: "publish", published: "1" });
                if (page.published) toast.success("Hub updated.");
              }}
              className="os-btn-primary os-btn-primary--sm"
            >
              {page.published ? "Update" : "Publish"}
            </button>
          </div>
        ) : (
          <span />
        )}
      </div>

      {patternCover && (
        <HubCard
          inset
          cover={page.coverUrl as string}
          title={editing ? <InlineTitle value={titleDraft} onChange={(v) => setTitleDraft(v || page.title)} onCommit={commitTitle} /> : page.title}
          draft={!page.published}
          action={
            editing ? (
              <button
                type="button"
                aria-label="Change cover"
                title="Change cover"
                onClick={() => setStudio(true)}
                className="grid h-9 w-9 place-items-center rounded-full border border-[var(--os-on-art-line)] text-[var(--os-on-art-ink)] outline-none transition-colors duration-150 hover:bg-[var(--os-on-art-chip-hover)] focus-visible:ring-2 focus-visible:ring-[var(--os-on-art-ink)]"
              >
                <ImagePlus className="h-4 w-4" aria-hidden />
              </button>
            ) : undefined
          }
        />
      )}

      {!patternCover && (page.coverUrl || editing) && (
        <div className="relative mb-6 -mx-6 sm:-mx-10">
          <div className="overflow-hidden">
            {page.coverUrl ? (
              <img src={page.coverUrl} alt="" className="aspect-[16/5] w-full object-cover" />
            ) : (
              <div className="flex aspect-[16/5] w-full items-center justify-center bg-os-well" />
            )}
          </div>
          {editing && (
            <div className="absolute bottom-3 right-3 flex items-center gap-1">
              <IconButton
                label={page.coverUrl ? "Change cover" : "Add cover"}
                icon={ImagePlus}
                onClick={() => setStudio(true)}
              />
            </div>
          )}
        </div>
      )}
      </div>

      {page.hasDomain && <ResourceHubTabs pageId={page.id} className="-mb-[13px] -ml-[13px] px-3 sm:px-[54px]" />}

      <div className="flex items-start gap-2 px-3 sm:px-[54px]">
        {patternCover ? (
          <span className="w-full" />
        ) : editing ? (
          <h1 className="w-full font-heading text-5xl font-semibold">
            <InlineTitle value={titleDraft} onChange={(v) => setTitleDraft(v || page.title)} onCommit={commitTitle} />
          </h1>
        ) : (
          <h1 className="w-full font-heading text-5xl font-semibold">{page.title}</h1>
        )}
      </div>

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
          className="mt-4 min-h-[70vh]"
        />
      ) : (
        <DocEditor
          key={`${page.id}-read`}
          features="resource"
          editable={false}
          className="mt-4 min-h-[70vh] [&_.bn-editor]:!px-0"
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
      {studio && (
        <CoverStudio
          busy={fetcher.state !== "idle"}
          heading={page.coverUrl ? "Change cover" : "Add cover"}
          submitLabel="Save"
          initialTitle={page.title}
          initialCover={page.coverUrl}
          uploadImage={uploadEditorImage}
          onClose={() => setStudio(false)}
          onSubmit={(title, url) => {
            if (!title.trim()) return;
            submit({ intent: "banner", title, url });
            setStudio(false);
          }}
        />
      )}
    </div>
  );
}
