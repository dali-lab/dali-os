import { Link, useLoaderData } from "react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import type { Route } from "./+types/resources.blog.$postId";
import { DocEditor } from "~/components/doc";
import { fullName, formatDateShort } from "~/lib/display";
import { loadBlogPost } from "~/lib/blog-post.server";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";

// The reading page. Editing happens on /resources/write/:postId.
export async function loader({ request, params }: Route.LoaderArgs) {
  const { post, canEdit } = await loadBlogPost(request, params.postId!);
  return {
    post: {
      id: post.id,
      title: post.title,
      summary: post.summary,
      contentJson: post.contentJson,
      published: post.publishedAt !== null,
      date: post.publishedAt ? formatDateShort(post.publishedAt) : null,
      author: fullName(post.author),
    },
    canEdit,
  };
}

export default function BlogPostPage() {
  const { post, canEdit } = useLoaderData<typeof loader>();

  return (
    <article className="mx-auto max-w-3xl pt-4">
      <div className="flex items-center gap-3 py-4">
        <Link
          to="/resources"
          className="mr-auto inline-flex items-center gap-1.5 text-sm text-os-grey hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          The Scoop
        </Link>
        {!post.published && <Pill dot="neutral">Draft</Pill>}
        {canEdit && (
          <Link to={`/resources/write/${post.id}`} className="os-btn-primary os-btn-primary--sm">
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        )}
      </div>
      {/* Same inline gutter as the editor below, so the headline sits flush
          with the body text. */}
      <div className="px-3 sm:px-[54px]">
        <h1 className="font-serif text-5xl font-bold leading-tight text-foreground">{post.title}</h1>
        {post.summary && <p className="mt-3 font-serif text-xl text-os-grey">{post.summary}</p>}
        <p className="mt-3 border-b border-border pb-4 text-xs font-semibold uppercase tracking-wider text-os-grey">
          {post.author}
          {post.date && <span className="font-normal normal-case tracking-normal"> · {post.date}</span>}
        </p>
      </div>
      <DocEditor
        key={post.id}
        features="resource"
        editable={false}
        initialContent={post.contentJson ?? []}
      />
    </article>
  );
}
