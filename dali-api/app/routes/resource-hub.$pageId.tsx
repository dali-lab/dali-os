import { useEffect, useRef, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData, useNavigate } from "react-router";
import { ArrowLeft, ImagePlus, Trash2 } from "lucide-react";
import type { Route } from "./+types/resource-hub.$pageId";
import {
  DocEditor,
  IMAGE_UPLOAD_ACCEPT,
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
import { COVER_DECOR, COVER_PATTERNS, CoverPattern, InlineTitle, buildCoverUrl, isPatternCover, parseCover } from "~/components/resource-hub/CoverPattern";
import { useDialog } from "~/components/ui/dialog";
import { Modal, ModalHeader } from "~/components/Modal";
import { useToast } from "~/components/ui/toast";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.page.title ?? "Resource Hub"} · DALI OS` },
];

export const handle = { bleedPane: true };

// Soft tints only: the page text stays dark on all of them.
const BG_COLORS = ["#fdf2f2", "#fff6e8", "#fffbe6", "#eefaf0", "#eaf4ff", "#f3eefc", "#f1f1ef"];

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
      bgColor: page.bgColor,
      published: page.publishedAt !== null,
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
    case "color": {
      const color = String(form.get("color") ?? "");
      if (color && !BG_COLORS.includes(color)) {
        return Response.json({ error: "Invalid color" }, { status: 400 });
      }
      await prisma.resourceHubPage.update({ where, data: { bgColor: color || null } });
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [sync, setSync] = useState<DocSyncState>("saved");
  const [editor, setEditor] = useState<DocEditorInstance | null>(null);
  const [preview, setPreview] = useState(false);
  // Blocks as they stood when Preview was pressed, read before the live editor unmounts.
  const [snapshot, setSnapshot] = useState<unknown[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [coverMenu, setCoverMenu] = useState(false);
  const coverMenuRef = useRef<HTMLDivElement>(null);
  const [titleDraft, setTitleDraft] = useState(page.title);
  const cover = parseCover(page.coverUrl);

  useEffect(() => setTitleDraft(page.title), [page.title]);
  useEffect(() => {
    if (!coverMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!coverMenuRef.current?.contains(e.target as Node)) setCoverMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCoverMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [coverMenu]);

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
  const hasCover = !!page.coverUrl || (canEdit && !!collabToken && !preview);
  const pill = hasCover ? "rounded-full bg-os-bg/85 px-2.5 py-1 backdrop-blur" : "";
  const live = canEdit && !!collabToken;
  const editing = live && !preview;

  async function pickCover(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      submit({ intent: "cover", url: await uploadEditorImage(file) });
    } catch {
      toast.error("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

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
      style={page.bgColor ? { backgroundColor: page.bgColor, color: "#1f1f1f" } : undefined}
    >
      <div className="relative">
      <div
        className={
          hasCover
            ? "absolute -left-6 -right-6 top-0 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-4 sm:-left-10 sm:-right-10 sm:px-10"
            : "-mx-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3 bg-os-bg px-6 py-4 sm:-mx-10 sm:px-10"
        }
      >
        <Link
          to="/resource-hub"
          onClick={(e) => {
            if (live && !page.published) {
              e.preventDefault();
              setLeave("asking");
            }
          }}
          className={`inline-flex items-center gap-1.5 justify-self-start text-sm text-os-grey hover:text-foreground ${pill}`}
        >
          <ArrowLeft className="h-4 w-4" />
          Resource Hub
        </Link>
        <span className={`text-sm text-os-grey ${live && !preview ? pill : ""}`}>{live && !preview ? SYNC_LABEL[sync] : ""}</span>
        {live ? (
          <div className={`flex items-center gap-2 justify-self-end ${pill}`}>
            <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={remove} />
            <button
              type="button"
              onClick={() => {
                if (!preview && editor) setSnapshot(editor.document as unknown[]);
                setPreview((on) => !on);
              }}
              aria-pressed={preview}
              className="inline-flex h-8 items-center rounded-lg border border-os-container-hi px-3 text-sm font-medium text-foreground transition-colors hover:bg-os-hover"
            >
              {preview ? "Edit" : "Preview"}
            </button>
            <button
              type="button"
              disabled={fetcher.state !== "idle"}
              onClick={() => submit({ intent: "publish", published: page.published ? "0" : "1" })}
              className="os-btn-primary os-btn-primary--sm !text-white"
            >
              {page.published ? "Unpublish" : "Publish"}
            </button>
          </div>
        ) : (
          <span />
        )}
      </div>

      {(page.coverUrl || editing) && (
        <div className="relative mb-6 -mx-6 sm:-mx-10">
          <div className="overflow-hidden">
            {isPatternCover(page.coverUrl) ? (
              <CoverPattern
                url={page.coverUrl}
                title={titleDraft}
                {...(editing ? { onTitleChange: (v: string) => setTitleDraft(v || page.title), onTitleCommit: commitTitle } : null)}
              />
            ) : page.coverUrl ? (
              <img src={page.coverUrl} alt="" className="aspect-[16/5] w-full object-cover" />
            ) : (
              <div className="flex aspect-[16/5] w-full items-center justify-center bg-black/[0.04]" />
            )}
          </div>
          {editing && (
            <div ref={coverMenuRef} className="absolute bottom-3 right-3 flex items-center gap-1">
              {coverMenu && (
                <div
                  role="dialog"
                  aria-label="Cover style"
                  className="absolute right-0 top-full z-30 mt-2 w-[380px] max-w-[calc(100vw-48px)] rounded-os-card border border-os-container bg-os-card p-4 shadow-lg"
                >
                  <p className="mb-2 text-sm font-semibold text-foreground">Cover style</p>
                  <div className="grid grid-cols-2 gap-3">
                    {COVER_PATTERNS.map((pt) => {
                      const selected = cover?.id === pt.id;
                      return (
                        <button
                          key={pt.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => submit({ intent: "cover", url: buildCoverUrl(pt.id, cover?.decor ?? []) })}
                          className="group/thumb flex flex-col gap-1 text-left focus-visible:outline-none"
                        >
                          <span
                            className={`block overflow-hidden rounded-lg border transition-shadow group-hover/thumb:shadow-md group-focus-visible/thumb:ring-2 group-focus-visible/thumb:ring-os-accent/60 ${selected ? "border-os-accent ring-1 ring-os-accent" : "border-os-container"}`}
                          >
                            <CoverPattern url={buildCoverUrl(pt.id, cover?.decor ?? [])} title={titleDraft} />
                          </span>
                          <span className="text-xs text-os-grey">{pt.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="mb-2 mt-4 text-sm font-semibold text-foreground">Decor</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Decor">
                    {COVER_DECOR.map((d) => {
                      const on = !!cover?.decor.includes(d.id);
                      return (
                        <button
                          key={d.id}
                          type="button"
                          aria-pressed={on}
                          disabled={!cover}
                          title={cover ? undefined : "Pick a cover style first"}
                          onClick={() =>
                            cover &&
                            submit({
                              intent: "cover",
                              url: buildCoverUrl(cover.id, on ? cover.decor.filter((x) => x !== d.id) : [...cover.decor, d.id]),
                            })
                          }
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/60 disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-os-accent bg-os-accent/10 text-foreground" : "border-os-container text-os-grey hover:bg-os-hover hover:text-foreground"}`}
                        >
                          {d.name}
                        </button>
                      );
                    })}
                  </div>
                  {page.coverUrl && !cover && (
                    <p className="mt-2 text-xs text-os-grey">Decor and the title work with cover styles, not uploaded images.</p>
                  )}

                  <div className="mt-4 flex items-center justify-between border-t border-os-container pt-3">
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => {
                        setCoverMenu(false);
                        fileRef.current?.click();
                      }}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-os-hover"
                    >
                      <ImagePlus className="h-4 w-4 text-os-grey" aria-hidden />
                      Upload an image
                    </button>
                    {page.coverUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          submit({ intent: "cover", url: "" });
                          setCoverMenu(false);
                        }}
                        className="rounded-lg border border-os-container px-3 py-1 text-sm text-foreground hover:bg-os-hover"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              )}
              <IconButton
                label={uploading ? "Uploading" : page.coverUrl ? "Change cover" : "Add cover"}
                icon={ImagePlus}
                disabled={uploading}
                onClick={() => setCoverMenu((o) => !o)}
              />
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void pickCover(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      )}
      </div>

      <div className="flex items-start gap-2 px-3 sm:px-[54px]">
        {editing && isPatternCover(page.coverUrl) ? (
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
          title="Publish this hub?"
          subtitle="Members can see it once it's published. Otherwise it stays a draft that only you and editors can open."
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
            No, save as draft
          </button>
          <button
            type="button"
            disabled={leave === "publishing"}
            onClick={() => {
              setLeave("publishing");
              submit({ intent: "publish", published: "1" });
            }}
            className="os-btn-primary os-btn-primary--sm !text-white"
          >
            Publish
          </button>
        </div>
      </Modal>
    </div>
  );
}
