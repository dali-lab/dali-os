import { useRef, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { ArrowLeft, Eye, ImagePlus, Trash2, X } from "lucide-react";
import type { Route } from "./+types/resources.write.$postId";
import { DocEditor, IMAGE_UPLOAD_ACCEPT, uploadEditorImage, type DocSyncState } from "~/components/doc";
import { blogPostRoomName } from "~/collab/roomName";
import { prisma } from "~/lib/db";
import { DEFAULT_BLOG_COVER, blogListing } from "~/lib/blog-preview";
import { loadBlogPost, pinBlogPostToTop, unpinBlogPost } from "~/lib/blog-post.server";
import { getCollabToken } from "~/lib/collab-token.server";
import { useOsChrome } from "~/components/os-chrome";
import { IconButton } from "~/components/ui/IconButton";
import { Toggle } from "~/components/ui/Toggle";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";

export const meta: Route.MetaFunction = () => [{ title: "Write · DALI OS" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { viewer, post, canEdit } = await loadBlogPost(request, params.postId!);
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
      published: post.publishedAt !== null,
      pinned: post.frontPageRank !== null,
    },
    canPin: viewer.core,
    collabToken: await getCollabToken(request),
    currentUserId: viewer.user.sub,
    userName: viewer.userName,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { viewer, post, canEdit } = await loadBlogPost(request, params.postId!);
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
      await prisma.blogPost.update({
        where,
        data: { visibility: form.get("public") === "1" ? "Public" : "Internal" },
      });
      return { ok: true };
    case "publish": {
      const publish = form.get("published") === "1";
      await prisma.blogPost.update({
        where,
        data: publish
          ? { publishedAt: post.publishedAt ?? new Date() }
          : // Only a published post holds a pin.
            { publishedAt: null, frontPageRank: null },
      });
      return { ok: true };
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

export default function BlogWritePage() {
  const { post, canPin, collabToken, currentUserId, userName } = useLoaderData<typeof loader>();
  const chrome = useOsChrome();
  const fetcher = useFetcher();
  const dialog = useDialog();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sync, setSync] = useState<DocSyncState>("saved");
  const [uploading, setUploading] = useState(false);

  const submit = (data: Record<string, string>) => fetcher.submit(data, { method: "post" });

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
      description: post.isPublic && post.published ? "It also comes off the DALI website." : undefined,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) submit({ intent: "delete" });
  }

  if (!collabToken) {
    return <p className="text-sm italic text-muted-foreground">Sign in again to write.</p>;
  }

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
        <Pill dot={post.published ? "success" : "neutral"}>
          {post.published ? "Published" : "Draft"}
        </Pill>
        <Link to={`/resources/blog/${post.id}`} aria-label="Preview" className={chrome.iconBtn}>
          <Eye className="h-4 w-4" />
        </Link>
        <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={remove} />
        <button
          type="button"
          onClick={() => submit({ intent: "publish", published: post.published ? "0" : "1" })}
          className="os-btn-primary os-btn-primary--sm"
        >
          {post.published ? "Unpublish" : "Publish"}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className={`${chrome.panel} ${chrome.panelPad} min-w-0`}>
          <input
            type="text"
            aria-label="Title"
            defaultValue={post.title === "Untitled" ? "" : post.title}
            placeholder="Title"
            onBlur={(e) => {
              const title = e.target.value.trim();
              if (title && title !== post.title) submit({ intent: "title", title });
            }}
            // Same inline gutter as the editor below (its block-handle column),
            // so the title sits flush with the body text.
            className="w-full bg-transparent px-3 sm:px-[54px] font-serif text-5xl font-bold leading-tight text-foreground outline-none placeholder:text-os-muted"
          />
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
            placeholder="Tell your story, or press '/' for blocks"
            className="mt-4 min-h-[65vh]"
          />
        </div>

        <aside className={`${chrome.panel} ${chrome.panelPad} ${chrome.formClass} flex h-fit flex-col gap-5`}>
          <h2 className={chrome.heading}>The Scoop</h2>

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
              defaultValue={post.summary}
              placeholder={post.derivedExcerpt || "Shown under the headline"}
              onBlur={(e) => {
                if (e.target.value.trim() !== post.summary) {
                  submit({ intent: "summary", summary: e.target.value });
                }
              }}
            />
          </label>

          <Toggle
            tone="os"
            label="Public"
            description="Also on the DALI website"
            checked={post.isPublic}
            onChange={(e) => submit({ intent: "visibility", public: e.target.checked ? "1" : "0" })}
          />
          {canPin && (
            <Toggle
              tone="os"
              label="Pin to top"
              description={post.published ? undefined : "Publish first"}
              disabled={!post.published}
              checked={post.pinned}
              onChange={(e) => submit({ intent: "pin", pinned: e.target.checked ? "1" : "0" })}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
