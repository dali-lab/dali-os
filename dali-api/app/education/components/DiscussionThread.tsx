import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";
import { MentionText } from "~/components/MentionText";

interface Reply {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  isFromInstructor: boolean;
  createdAt: string;
  editedAt: string | null;
}

interface Post {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  isFromInstructor: boolean;
  createdAt: string;
  editedAt: string | null;
  iAmSubscribed: boolean;
  replies: Reply[];
}

export interface DiscussionThreadProps {
  offeringId: string;
  viewerUserId: string;
  posts: Post[];
}

export function DiscussionThread({ offeringId, viewerUserId, posts }: DiscussionThreadProps) {
  const [composing, setComposing] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { revalidate } = useRevalidator();

  async function post() {
    if (!composing.trim()) return;
    setPosting(true);
    setError(null);
    const res = await fetch(`/api/education/offerings/${offeringId}/discussion`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: composing }),
    });
    setPosting(false);
    if (res.ok) {
      setComposing("");
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Post failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <textarea
          value={composing}
          onChange={(e) => setComposing(e.target.value)}
          placeholder="Start a discussion..."
          rows={3}
          className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
        />
        {error && <div className="mt-2 text-sm text-red-700">{error}</div>}
        <div className="mt-2 flex justify-end">
          <Button variant="primary" size="sm" disabled={posting || !composing.trim()} onClick={post}>
            {posting ? "Posting..." : "Post"}
          </Button>
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No discussions yet — start one above.</p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p.id} id={`post-${p.id}`}>
              <PostCard post={p} offeringId={offeringId} viewerUserId={viewerUserId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PostCard({
  post,
  offeringId,
  viewerUserId,
}: {
  post: Post;
  offeringId: string;
  viewerUserId: string;
}) {
  const { revalidate } = useRevalidator();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.body);
  const [editBusy, setEditBusy] = useState(false);
  const isOwner = post.authorId === viewerUserId;

  async function sendReply() {
    if (!replyText.trim()) return;
    setReplyBusy(true);
    const res = await fetch(`/api/education/offerings/${offeringId}/discussion`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyText, parentPostId: post.id }),
    });
    setReplyBusy(false);
    if (res.ok) {
      setReplyText("");
      setReplyOpen(false);
      revalidate();
    }
  }

  async function toggleSubscription() {
    setSubBusy(true);
    const method = post.iAmSubscribed ? "DELETE" : "POST";
    await fetch(`/api/education/discussion/${post.id}/subscription`, {
      method,
      credentials: "include",
    });
    setSubBusy(false);
    revalidate();
  }

  async function saveEdit() {
    setEditBusy(true);
    const res = await fetch(`/api/education/discussion/${post.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editText }),
    });
    setEditBusy(false);
    if (res.ok) {
      setEditing(false);
      revalidate();
    }
  }

  async function deletePost() {
    if (!confirm("Delete this post and all replies?")) return;
    const res = await fetch(`/api/education/discussion/${post.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) revalidate();
  }

  return (
    <div className={`rounded-2xl border ${post.isFromInstructor ? "border-accent-teal/40 bg-accent-teal/5" : "border-border bg-card"} p-4`}>
      <PostHeader
        authorName={post.authorName}
        isFromInstructor={post.isFromInstructor}
        createdAt={post.createdAt}
        editedAt={post.editedAt}
      />
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={saveEdit} disabled={editBusy}>
              {editBusy ? "Saving..." : "Save"}
            </Button>
            <button onClick={() => setEditing(false)} className="text-xs text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2">
          <MentionText body={post.body} />
        </p>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs">
        <button onClick={() => setReplyOpen(!replyOpen)} className="text-accent-coral hover:underline">
          Reply
        </button>
        <button
          onClick={toggleSubscription}
          disabled={subBusy}
          className="text-muted-foreground hover:text-dark-blue"
        >
          {post.iAmSubscribed ? "Unsubscribe" : "Subscribe"}
        </button>
        {isOwner && !editing && (
          <>
            <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-dark-blue">
              Edit
            </button>
            <button onClick={deletePost} className="text-red-600 hover:underline">
              Delete
            </button>
          </>
        )}
      </div>

      {post.replies.length > 0 && (
        <ul className="mt-4 ml-6 border-l-2 border-border pl-4 space-y-3">
          {post.replies.map((r) => (
            <li key={r.id}>
              <ReplyCard reply={r} offeringId={offeringId} viewerUserId={viewerUserId} />
            </li>
          ))}
        </ul>
      )}

      {replyOpen && (
        <div className="mt-4 ml-6 border-l-2 border-accent-coral/40 pl-4 space-y-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            placeholder={`Reply to ${post.authorName}...`}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={replyBusy || !replyText.trim()} onClick={sendReply}>
              {replyBusy ? "Replying..." : "Reply"}
            </Button>
            <button onClick={() => setReplyOpen(false)} className="text-xs text-muted-foreground hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyCard({
  reply,
  offeringId,
  viewerUserId,
}: {
  reply: Reply;
  offeringId: string;
  viewerUserId: string;
}) {
  const { revalidate } = useRevalidator();
  const isOwner = reply.authorId === viewerUserId;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(reply.body);

  async function saveEdit() {
    const res = await fetch(`/api/education/discussion/${reply.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    if (res.ok) {
      setEditing(false);
      revalidate();
    }
  }
  async function deleteReply() {
    if (!confirm("Delete this reply?")) return;
    const res = await fetch(`/api/education/discussion/${reply.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) revalidate();
  }

  return (
    <div>
      <PostHeader
        authorName={reply.authorName}
        isFromInstructor={reply.isFromInstructor}
        createdAt={reply.createdAt}
        editedAt={reply.editedAt}
      />
      {editing ? (
        <div className="mt-1 space-y-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm"
          />
          <div className="flex gap-2 text-xs">
            <button onClick={saveEdit} className="text-accent-coral hover:underline">Save</button>
            <button onClick={() => setEditing(false)} className="text-muted-foreground hover:underline">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mt-1">
          <MentionText body={reply.body} />
        </p>
      )}
      {isOwner && !editing && (
        <div className="mt-1 flex gap-3 text-xs">
          <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-dark-blue">
            Edit
          </button>
          <button onClick={deleteReply} className="text-red-600 hover:underline">Delete</button>
        </div>
      )}
    </div>
  );
}

function PostHeader({
  authorName,
  isFromInstructor,
  createdAt,
  editedAt,
}: {
  authorName: string;
  isFromInstructor: boolean;
  createdAt: string;
  editedAt: string | null;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="font-semibold text-dark-blue">{authorName}</span>
      {isFromInstructor && (
        <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-accent-teal/15 text-accent-teal">
          Instructor
        </span>
      )}
      <span>· {new Date(createdAt).toLocaleString()}</span>
      {editedAt && <span className="italic">edited</span>}
    </div>
  );
}
