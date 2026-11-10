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
import { PostComments } from "~/components/PostComments";
import { ReactionBar, useReactionToggle } from "~/components/ReactionBar";
import { BLOG_COMMENT_MAX, BLOG_EMOJI } from "~/lib/blog-engagement";
import {
  blogEngagementAction,
  loadBlogEngagement,
  type BlogEngagement,
} from "~/lib/blog-engagement.server";
import { requireResourcesViewer } from "~/lib/resources.server";

function reader(viewer: Awaited<ReturnType<typeof requireResourcesViewer>>) {
  return { id: viewer.user.sub, core: viewer.core, name: viewer.userName };
}

// The reading page. Editing happens on /resources/write/:postId.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { viewer, post, canEdit, canApprove } = await loadBlogPost(request, params.postId!);
  return {
    engagement: post.publishedAt ? await loadBlogEngagement(reader(viewer), post.id) : null,
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

export async function action({ request, params }: Route.ActionArgs) {
  return blogEngagementAction(request, reader(await requireResourcesViewer(request)), params.postId!);
}

export default function BlogPostPage() {
  const { post, canEdit, canApprove, engagement } = useLoaderData<typeof loader>();
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
          Everything DALI
        </Link>
        {post.status !== "published" && <BlogStatusPill status={post.status} />}
        {canEdit && (
          <div className="flex items-center gap-1">
            <Tooltip content="Edit">
              <Link to={writePath} aria-label="Edit" className={chrome.iconBtn}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Tooltip>
            <IconButton label="Delete" icon={Trash2} tone="destructive" onClick={remove} />
          </div>
        )}
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
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-os-grey">
          {post.author}
          {post.date && <span className="font-normal normal-case tracking-normal">{post.date}</span>}
        </p>
      </div>
      <DocEditor
        key={post.id}
        features="resource"
        editable={false}
        // No block handles when reading, so no gutter for them either.
        className="mt-8 [&_.bn-editor]:!px-0"
        initialContent={post.contentJson ?? []}
      />
      {engagement && <StoryResponses postId={post.id} {...engagement} />}
    </article>
  );
}

function StoryResponses({
  postId,
  reactions: loaded,
  comments,
}: { postId: string } & BlogEngagement) {
  const { reactions, react } = useReactionToggle(postId, loaded);
  return (
    <section aria-label="Responses" className="mt-10 flex flex-col gap-4 pb-10">
      <ReactionBar reactions={reactions} palette={BLOG_EMOJI} onReact={react} />
      <PostComments postId={postId} comments={comments} maxLength={BLOG_COMMENT_MAX} />
    </section>
  );
}
