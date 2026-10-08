import { Link, useFetcher, useLoaderData } from "react-router";
import { ArrowLeft, Check, Pencil, Trash2 } from "lucide-react";
import type { Route } from "./+types/resources.blog.$postId";
import { DocEditor } from "~/components/doc";
import { fullName, formatDateShort } from "~/lib/display";
import { blogStatus, loadBlogPost } from "~/lib/blog-post.server";
import { BlogStatusPill } from "~/components/blog/BlogStatusPill";
import { useOsChrome } from "~/components/os-chrome";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating/Tooltip";
import { useDialog } from "~/components/ui/dialog";

// The reading page. Editing happens on /resources/write/:postId.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { post, canEdit, canApprove } = await loadBlogPost(request, params.postId!);
  return {
    post: {
      id: post.id,
      title: post.title,
      summary: post.summary,
      contentJson: post.contentJson,
      status: blogStatus(post),
      isPublic: post.visibility === "Public",
      date: post.publishedAt ? formatDateShort(post.publishedAt) : null,
      author: fullName(post.author),
    },
    canEdit,
    canApprove,
  };
}

export default function BlogPostPage() {
  const { post, canEdit, canApprove } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const chrome = useOsChrome();
  const dialog = useDialog();
  const writePath = `/resources/write/${post.id}`;

  async function remove() {
    const ok = await dialog.confirm({
      title: "Delete this post?",
      description:
        post.isPublic && post.status === "published" ? "It also comes off the DALI website." : undefined,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "delete" }, { method: "post", action: writePath });
  }

  return (
    <article className="pt-4">
      <div className="flex items-center gap-3 py-4">
        <Link
          to="/resources"
          className="mr-auto inline-flex items-center gap-1.5 text-sm text-os-grey hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          The Scoop
        </Link>
        {post.status !== "published" && <BlogStatusPill status={post.status} />}
        {canApprove && post.status === "review" && (
          <button
            type="button"
            disabled={fetcher.state !== "idle"}
            onClick={() =>
              fetcher.submit(
                { intent: "publish", published: "1" },
                { method: "post", action: writePath },
              )
            }
            className="os-btn-primary os-btn-primary--sm"
          >
            <Check className="h-4 w-4" />
            Approve
          </button>
        )}
      </div>
      <div className="border-b border-border pb-4">
        <h1 className="font-heading text-5xl font-semibold leading-tight text-foreground">{post.title}</h1>
        {post.summary && <p className="mt-3 text-xl text-os-grey">{post.summary}</p>}
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-os-grey">
          {post.author}
          {post.date && <span className="font-normal normal-case tracking-normal"> · {post.date}</span>}
        </p>
        {canEdit && (
          <div className="-ml-1.5 mt-2 flex items-center gap-1">
            <Tooltip content="Edit">
              <Link to={writePath} aria-label="Edit" className={chrome.iconBtn}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Tooltip>
            <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={remove} />
          </div>
        )}
      </div>
      <DocEditor
        key={post.id}
        features="resource"
        editable={false}
        // No block handles when reading, so no gutter for them either.
        className="[&_.bn-editor]:!px-0"
        initialContent={post.contentJson ?? []}
      />
    </article>
  );
}
