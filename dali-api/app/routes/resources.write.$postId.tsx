import { useEffect, useId, useRef, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { ArrowLeft, ImagePlus, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { Route } from "./+types/resources.write.$postId";
import {
  DocEditor,
  IMAGE_UPLOAD_ACCEPT,
  uploadEditorImage,
  type DocEditorInstance,
  type DocSyncState,
} from "~/components/doc";
import { blogPostRoomName } from "~/collab/roomName";
import { prisma } from "~/lib/db";
import { isAiEnabled } from "~/lib/ai.server";
import { DEFAULT_BLOG_COVER, blogListing } from "~/lib/blog-preview";
import {
  blogStatus,
  loadBlogPost,
  pinBlogPostToTop,
  publishBlogPost,
  unpinBlogPost,
  unpublishBlogPost,
} from "~/lib/blog-post.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { useOsChrome } from "~/components/os-chrome";
import { Modal, ModalHeader } from "~/components/Modal";
import { BlogAiMenu } from "~/components/blog/BlogAiMenu";
import { BlogStatusPill } from "~/components/blog/BlogStatusPill";
import { IconButton } from "~/components/ui/IconButton";
import { Toggle } from "~/components/ui/Toggle";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export const meta: Route.MetaFunction = () => [{ title: "Write · DALI OS" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { viewer, post, canEdit, canApprove } = await loadBlogPost(request, params.postId!);
  if (!canEdit) throw new Response("Not found", { status: 404 });
  return {
    post: {
      id: post.id,
      title: post.title,
      summary: post.summary ?? "",
      derivedExcerpt: post.excerpt,
      customCoverUrl: post.customCoverUrl,
      coverImageUrl: blogListing(post).coverImageUrl,
      isPublic: post.visibility === "Public",
      status: blogStatus(post),
      pinned: post.frontPageRank !== null,
    },
    canPin: viewer.core,
    canApprove,
    aiEnabled: isAiEnabled(),
    collabToken: await getCollabToken(request),
    currentUserId: viewer.user.sub,
    userName: viewer.userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { viewer, post, canEdit, canApprove } = await loadBlogPost(request, params.postId!);
  if (!canEdit) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const where = { id: post.id };

  switch (form.get("intent")) {
    case "title": {
      const title = String(form.get("title") ?? "").trim();
      if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
      await prisma.blogPost.update({ where, data: { title } });
      return { ok: true };
    }
    case "summary":
      await prisma.blogPost.update({
        where,
        data: { summary: String(form.get("summary") ?? "").trim() || null },
      });
      return { ok: true };
    case "cover": {
      const url = String(form.get("url") ?? "");
      // Only the app's own upload redirect, never an arbitrary URL.
      if (url && !url.startsWith("/api/upload/raw?key=uploads%2F")) {
        return Response.json({ error: "Invalid image" }, { status: 400 });
      }
      await prisma.blogPost.update({ where, data: { customCoverUrl: url || null } });
      return { ok: true };
    }
    case "visibility":
      // An Admin approves a post for an audience; its author can't widen that after.
      if (!canApprove && blogStatus(post) !== "draft") {
        return Response.json({ error: "Move it back to a draft first." }, { status: 400 });
      }
      await prisma.blogPost.update({
        where,
        data: { visibility: form.get("public") === "1" ? "Public" : "Internal" },
      });
      return { ok: true };
    case "publish": {
      if (form.get("published") !== "1") {
        await unpublishBlogPost(post.id);
        return { ok: true };
      }
      const status = await publishBlogPost(post, { id: viewer.user.sub, canApprove });
      return { ok: true, submitted: status === "review" };
    }
    case "pin":
      if (!viewer.core) throw new Response("Forbidden", { status: 403 });
      if (form.get("pinned") === "1") await pinBlogPostToTop(post.id);
      else await unpinBlogPost(post.id);
      return { ok: true };
    case "delete":
      await prisma.$transaction([
        prisma.collabDocument.deleteMany({ where: { name: blogPostRoomName(post.id) } }),
        prisma.blogPost.delete({ where }),
      ]);
      return redirect("/resources");
    default:
      throw new Response("Bad request", { status: 400 });
  }
}

const SYNC_LABEL: Record<DocSyncState, string> = {
  saving: "Saving",
  saved: "Saved",
  offline: "Offline",
};

// A long title wraps and the field grows with it, as the headline does on the
// read page, instead of running off the end of one line.
function TitleField({ title, onSave }: { title: string; onSave: (title: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    fit();
    // The heading face can land after first paint and re-wrap the line.
    void document.fonts?.ready.then(fit);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label="Title"
      defaultValue={title === "Untitled" ? "" : title}
      placeholder="Title"
      onInput={fit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.target.value.replace(/\s+/g, " ").trim();
        if (next && next !== title) onSave(next);
      }}
      // Same inline gutter as the editor below (its block-handle column),
      // so the title sits flush with the body text.
      className="block w-full resize-none overflow-hidden bg-transparent px-3 sm:px-[54px] font-heading text-5xl font-semibold leading-tight text-foreground outline-none placeholder:text-os-muted"
    />
  );
}

type ActionResult = { ok?: boolean; submitted?: boolean; error?: string };

export default function BlogWritePage() {
  const { post, canPin, canApprove, aiEnabled, collabToken, currentUserId, userName } =
    useLoaderData<typeof loader>();
  const chrome = useOsChrome();
  const fetcher = useFetcher<ActionResult>();
  const dialog = useDialog();
  const toast = useToast();
  const detailsTitleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sync, setSync] = useState<DocSyncState>("saved");
  const [uploading, setUploading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [summary, setSummary] = useState(post.summary);
  const savedSummary = useRef(post.summary);
  const [editor, setEditor] = useState<DocEditorInstance | null>(null);
  const handled = useRef<ActionResult | undefined>(undefined);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });

  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data || handled.current === data) return;
    handled.current = data;
    if (data.error) toast.error(data.error);
    else if (data.submitted) toast.success("Sent to the admins for review");
  }, [fetcher.state, fetcher.data, toast]);

  // Escape closes the modal without blurring the field, so closing saves too.
  function saveSummary() {
    const next = summary.trim();
    if (next === savedSummary.current) return;
    savedSummary.current = next;
    submit({ intent: "summary", summary: next });
  }

  function closeDetails() {
    saveSummary();
    setDetailsOpen(false);
  }

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
      title: "Delete this post?",
      description:
        post.isPublic && post.status === "published" ? "It also comes off the DALI website." : undefined,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) submit({ intent: "delete" });
  }

  if (!collabToken) {
    return <p className="text-sm italic text-muted-foreground">Sign in again to write.</p>;
  }

  const isDraft = post.status === "draft";
  // Only an Admin publishes; anyone else sends the draft to them.
  const publishLabel =
    post.status === "published"
      ? "Unpublish"
      : canApprove
        ? isDraft
          ? "Publish"
          : "Approve"
        : isDraft
          ? "Submit for review"
          : "Withdraw";
  const audienceLocked = !canApprove && !isDraft;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/resources"
          className="mr-auto inline-flex items-center gap-1.5 text-sm text-os-grey hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          The Scoop
        </Link>
        <span className="text-sm text-os-grey">{SYNC_LABEL[sync]}</span>
        <BlogStatusPill status={post.status} />
        {aiEnabled && <BlogAiMenu editor={editor} />}
        <IconButton label="Post details" icon={SlidersHorizontal} onClick={() => setDetailsOpen(true)} />
        <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={remove} />
        <button
          type="button"
          disabled={fetcher.state !== "idle"}
          onClick={() =>
            submit({
              intent: "publish",
              published: post.status === "published" || publishLabel === "Withdraw" ? "0" : "1",
            })
          }
          className="os-btn-primary os-btn-primary--sm"
        >
          {publishLabel}
        </button>
      </div>

      <div className={`${chrome.panel} ${chrome.panelPad} min-w-0`}>
        <TitleField title={post.title} onSave={(title) => submit({ intent: "title", title })} />
        <DocEditor
          features="resource"
          aiEnabled
          collab={{
            documentName: blogPostRoomName(post.id),
            token: collabToken,
            userName,
            userId: currentUserId,
          }}
          onSyncStateChange={setSync}
          onEditorReady={setEditor}
          placeholder="Tell your story, or press '/' for blocks"
          className="mt-4 min-h-[65vh]"
        />
      </div>

      <Modal open={detailsOpen} onClose={closeDetails} labelledBy={detailsTitleId}>
        <ModalHeader titleId={detailsTitleId} title="Post details" onClose={closeDetails} />
        <div className={`${chrome.formClass} flex flex-col gap-5`}>
          <div className="flex flex-col gap-1.5">
            <span className="os-field-label">Cover</span>
            <img
              src={post.coverImageUrl ?? DEFAULT_BLOG_COVER}
              alt=""
              className="aspect-[16/9] w-full rounded-os-item object-cover"
            />
            <div className="flex items-center gap-1">
              <IconButton
                label={uploading ? "Uploading" : "Upload cover"}
                icon={ImagePlus}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              />
              {post.customCoverUrl && (
                <IconButton
                  label="Use first image in post"
                  icon={X}
                  onClick={() => submit({ intent: "cover", url: "" })}
                />
              )}
            </div>
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

          <label className="flex flex-col gap-1.5">
            <span>Summary</span>
            <textarea
              rows={4}
              value={summary}
              placeholder={post.derivedExcerpt || "Shown under the headline"}
              onChange={(e) => setSummary(e.target.value)}
              onBlur={saveSummary}
            />
          </label>

          <Toggle
            tone="os"
            label="Public"
            description={audienceLocked ? "Move back to a draft to change" : "Also on the DALI website"}
            disabled={audienceLocked}
            checked={post.isPublic}
            onChange={(e) => submit({ intent: "visibility", public: e.target.checked ? "1" : "0" })}
          />
          {canPin && (
            <Toggle
              tone="os"
              label="Pin to top"
              description={post.status === "published" ? undefined : "Publish first"}
              disabled={post.status !== "published"}
              checked={post.pinned}
              onChange={(e) => submit({ intent: "pin", pinned: e.target.checked ? "1" : "0" })}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
