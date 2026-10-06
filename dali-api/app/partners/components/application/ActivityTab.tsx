// Activity tab, shared by PartnerApplicationModal and the full page:
// PartnerActivityFeed's timeline plus a note composer kept OUTSIDE it (so the
// same feed component works unmodified on both the modal, which can't rely
// on PartnerActivityFeed's own <Form> — that posts to whatever route it's
// mounted under — and the full page, which could use either). Email threads
// with partners@, when loaded, show as a short adjoining list.

import { useState } from "react";
import { Link } from "react-router";
import { Mail } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { MentionTextInput } from "~/components/MentionTextInput";
import { relativeTime } from "~/lib/relative-time";
import { PartnerActivityFeed, type PartnerActivity } from "../PartnerActivityFeed";
import type { ApplicationEmailThread } from "../../lib/partner-application-detail";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";

const NOTE_MAX = 10_000;

export function ActivityTab({
  applicationId,
  activities,
  actorNames,
  emailThreads = [],
  canEdit,
  limit,
  viewAllHref,
  onChanged,
}: {
  applicationId: string;
  activities: PartnerActivity[];
  actorNames: Record<string, string>;
  emailThreads?: ApplicationEmailThread[];
  canEdit: boolean;
  /** Caps the rendered rows (the modal's 8–10 row convention). Omit for the full page. */
  limit?: number;
  /** Shown as a "View all" link when `limit` trims the list. */
  viewAllHref?: string;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = limit ? activities.slice(0, limit) : activities;
  const truncated = limit !== undefined && activities.length > limit;

  async function postNote() {
    const body = note.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    const res = await postPartnerApplicationIntent(applicationId, "note", { body });
    setPosting(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't post that note.");
      return;
    }
    setNote("");
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <PartnerActivityFeed activities={shown} actorNames={actorNames} canEdit={false} />

      {truncated && viewAllHref && (
        <Link to={viewAllHref} className="self-start text-xs font-medium text-accent-coral hover:underline">
          View all {activities.length} activity rows →
        </Link>
      )}

      {emailThreads.length > 0 && (
        <section className="rounded-2xl border border-border bg-card">
          <header className="border-b border-border px-4 py-2.5">
            <h3 className="text-xs font-semibold text-foreground">Email with partners@</h3>
          </header>
          <ul className="divide-y divide-border">
            {emailThreads.slice(0, limit ?? emailThreads.length).map((t) => (
              <li key={t.indexId} className="flex items-start gap-3 px-4 py-2.5">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{t.subject || "(no subject)"}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.messageCount} message{t.messageCount === 1 ? "" : "s"} · {relativeTime(t.lastAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2">
          <MentionTextInput
            multiline
            value={note}
            onChange={setNote}
            rows={2}
            maxLength={NOTE_MAX}
            placeholder="Add an internal note, @ to mention someone…"
            className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={() => void postNote()} disabled={!note.trim() || posting}>
              {posting ? "Posting…" : "Add note"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
