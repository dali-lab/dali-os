import { useEffect, useRef } from "react";
import { useFetcher, useNavigate } from "react-router";
import { MoreHorizontal } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import type { GalleryTileData } from "~/community/lib/gallery.server";
import { GALLERY_REPORTS_TO_HIDE } from "~/community/lib/gallery";

type MenuPost = Pick<GalleryTileData, "id" | "mine" | "hidden" | "canModerate">;

/** Copy link for everyone; Report for others' posts; Delete for your own; Hide or Restore for Core. */
export function GalleryPostMenu({
  post,
  leaveOnDelete = false,
}: {
  post: MenuPost;
  /** On the post page, deleting goes back to the feed. */
  leaveOnDelete?: boolean;
}) {
  const fetcher = useFetcher<{ ok: boolean }>();
  const dialog = useDialog();
  const toast = useToast();
  const navigate = useNavigate();
  const href = `/community/gallery/${post.id}`;
  const submit = (fields: Record<string, string>) =>
    fetcher.submit({ postId: post.id, ...fields }, { method: "post", action: href });

  // Leave only once the delete has landed, so the feed's reload doesn't still show it.
  const leaving = useRef(false);
  useEffect(() => {
    if (leaving.current && fetcher.state === "idle" && fetcher.data?.ok) {
      navigate("/community/gallery", { replace: true });
    }
  }, [fetcher.state, fetcher.data, navigate]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      toast.success("Link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  async function report() {
    const reason = await dialog.prompt({
      title: "Report this post?",
      description: `Core will take a look. After ${GALLERY_REPORTS_TO_HIDE} reports it's hidden until Core reviews it.`,
      label: "What's wrong with it? (optional)",
      confirmLabel: "Report",
      tone: "destructive",
    });
    if (reason === null) return;
    submit({ intent: "report", reason });
    toast.success("Reported. Thanks for letting us know.");
  }

  async function remove() {
    const ok = await dialog.confirm({
      title: "Delete this post?",
      description: "The photo, its reactions and its comments go for good.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    leaving.current = leaveOnDelete;
    submit({ intent: "delete" });
  }

  return (
    <Menu
      align="right"
      ariaLabel="Post actions"
      trigger={<IconButton label="More" icon={MoreHorizontal} className="h-8 w-8 rounded-full" />}
    >
      <Menu.Item onSelect={copyLink}>Copy link</Menu.Item>
      {/* A document navigation, not a client one: the route redirects to a
          link S3 serves as an attachment, so the browser saves the file. */}
      <Menu.Item onSelect={() => window.location.assign(`${href}/download`)}>Download</Menu.Item>
      {!post.mine && <Menu.Item onSelect={report}>Report</Menu.Item>}
      {post.canModerate &&
        (post.hidden ? (
          <Menu.Item onSelect={() => submit({ intent: "restore" })}>Restore post</Menu.Item>
        ) : (
          <Menu.Item onSelect={() => submit({ intent: "hide" })}>Hide post</Menu.Item>
        ))}
      {post.mine && (
        <Menu.Item destructive onSelect={remove}>
          Delete
        </Menu.Item>
      )}
    </Menu>
  );
}
