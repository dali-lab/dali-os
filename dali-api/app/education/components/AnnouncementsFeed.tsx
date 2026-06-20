import { MentionText } from "~/components/MentionText";

interface Announcement {
  id: string;
  body: string;
  sentAt: string;
  author: { firstName: string | null; lastName: string | null };
}

export function AnnouncementsFeed({ items }: { items: Announcement[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No announcements yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">
            {`${a.author.firstName ?? ""} ${a.author.lastName ?? ""}`.trim() || "Instructor"} ·{" "}
            {new Date(a.sentAt).toLocaleString()}
          </p>
          <MentionText body={a.body} />
        </li>
      ))}
    </ul>
  );
}
