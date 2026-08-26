import { useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  ChevronRight,
  Eye,
  FolderPlus,
  Landmark,
  Lock,
  Plus,
  Users,
} from "lucide-react";
import { PageIcon } from "~/components/PageIcon";
import { FavoriteStar } from "~/components/FavoriteStar";
import { buttonClasses } from "~/components/ui/Button";
import { Tooltip } from "~/components/ui/floating";
import type { NoteSummary } from "~/members/lib/personal-notes.server";
import { NoteShareModal } from "./NoteShareModal";

// The notes rail on a member's profile.
//
// Design notes, since this is the first right-hand rail in the app:
//   - It reuses the page's existing card grammar (bg-card, border-border,
//     rounded-lg) so it reads as another section that happens to sit beside
//     the column rather than a new kind of surface.
//   - Tabs mirror UnderlineTabButtons' visual language — coral underline on
//     the active tab — at rail scale. That component's own spacing is built
//     for full-width page navigation and would swamp a 320px column, so the
//     grammar is borrowed rather than the component.
//   - Visibility is the one thing this list has to communicate at a glance,
//     so it's the only per-row adornment: a lock, an eye, or the lab mark.
//     Everything else (tags, dates, share counts) stays quiet or on the row's
//     second line, per the rule that one element does one job.

type Tab = "mine" | "shared";

function VisibilityMark({ note }: { note: NoteSummary }) {
  if (note.labListing === "Listed") {
    return (
      <Tooltip
        content="Listed on the lab-wide Documents page — visible to all lab members."
        variant="rich"
      >
        <span className="text-accent-teal">
          <Landmark className="w-3.5 h-3.5" aria-label="Listed lab-wide" />
        </span>
      </Tooltip>
    );
  }
  if (note.visibility === "public") {
    return (
      <Tooltip
        content="Public — visible on your profile to anyone with lab access."
        variant="rich"
      >
        <span className="text-accent-coral">
          <Eye className="w-3.5 h-3.5" aria-label="Public" />
        </span>
      </Tooltip>
    );
  }
  if (note.shareCount > 0) {
    return (
      <Tooltip
        content={`Shared with ${note.shareCount} ${note.shareCount === 1 ? "person or group" : "people and groups"} — only they can see it.`}
        variant="rich"
      >
        <span className="text-muted-foreground">
          <Users className="w-3.5 h-3.5" aria-label="Shared" />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Private — only you can see this page." variant="rich">
      <span className="text-muted-foreground/60">
        <Lock className="w-3.5 h-3.5" aria-label="Private" />
      </span>
    </Tooltip>
  );
}

function NoteRow({
  note,
  showOwner,
  canManage,
  favorited,
  onOpen,
  onManage,
}: {
  note: NoteSummary;
  showOwner: boolean;
  canManage: boolean;
  favorited: boolean;
  onOpen: (note: NoteSummary) => void;
  onManage: (note: NoteSummary) => void;
}) {
  return (
    // The row is a button, so the star sits beside it rather than inside —
    // a button within a button is invalid and swallows the click.
    <li className="flex items-center gap-1 pr-2">
      <button
        type="button"
        onClick={() => onOpen(note)}
        className="group flex-1 min-w-0 text-left px-2 py-1.5 rounded-md hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <PageIcon iconEmoji={note.iconEmoji} />
          <span className="truncate text-sm text-foreground flex-1 min-w-0">
            {note.title}
          </span>
          {canManage ? (
            // On your own notes the mark IS the control — it reads as state
            // and opens the dialog that changes it, so there's no separate
            // decoration that merely looks clickable.
            <span
              role="button"
              tabIndex={0}
              aria-label={`Change who can see ${note.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onManage(note);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                e.stopPropagation();
                onManage(note);
              }}
              className="shrink-0 rounded p-0.5 -m-0.5 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-coral/40"
            >
              <VisibilityMark note={note} />
            </span>
          ) : (
            <VisibilityMark note={note} />
          )}
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/70 transition-colors shrink-0" />
        </span>
        {(showOwner || note.tags.length > 0) && (
          <span className="flex items-center gap-1.5 pl-6 pt-0.5 text-xs text-muted-foreground min-w-0">
            {showOwner && note.owner && (
              <span className="truncate">{note.owner.name}</span>
            )}
            {showOwner && note.owner && note.tags.length > 0 && <span>·</span>}
            {note.tags.slice(0, 2).map((t) => (
              <span key={t.id} className="truncate">
                {t.label}
              </span>
            ))}
          </span>
        )}
      </button>
      <FavoriteStar pageId={note.id} favorited={favorited} />
    </li>
  );
}

export function PersonalNotesRail({
  ownerId,
  ownerFirstName,
  isSelf,
  notes,
  sharedWithMe,
  favoriteIds = [],
  onOpenNote,
}: {
  ownerId: string;
  ownerFirstName: string;
  isSelf: boolean;
  notes: NoteSummary[];
  sharedWithMe: NoteSummary[];
  /** Page ids the viewer has starred, for the per-row favorite toggle. */
  favoriteIds?: string[];
  onOpenNote: (note: NoteSummary) => void;
}) {
  const favorites = new Set(favoriteIds);
  const [tab, setTab] = useState<Tab>("mine");
  const [managing, setManaging] = useState<NoteSummary | null>(null);
  const revalidator = useRevalidator();
  const fetcher = useFetcher();
  const creating = fetcher.state !== "idle";

  const visible = isSelf && tab === "shared" ? sharedWithMe : notes;
  const showOwner = isSelf && tab === "shared";

  function create(isFolder: boolean) {
    fetcher.submit(
      { intent: "create", ownerId, isFolder: String(isFolder) },
      { method: "post", action: "/api/notes" },
    );
  }

  return (
    <aside className="bg-card border border-border rounded-lg flex flex-col">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
        <h2 className="font-heading font-semibold text-foreground">Pages</h2>
        {isSelf && (
          <div className="flex items-center gap-0.5">
            <Tooltip content="New folder">
              <button
                type="button"
                onClick={() => create(true)}
                disabled={creating}
                aria-label="New folder"
                className={buttonClasses("ghost", "sm")}
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            </Tooltip>
            <Tooltip content="New page">
              <button
                type="button"
                onClick={() => create(false)}
                disabled={creating}
                aria-label="New page"
                className={buttonClasses("ghost", "sm")}
              >
                <Plus className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {isSelf && (
        <div
          className="flex items-stretch gap-0.5 px-3 border-b border-border"
          role="tablist"
          aria-label="Pages"
        >
          {(
            [
              ["mine", "Mine", notes.length],
              ["shared", "Shared with me", sharedWithMe.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold font-heading border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-accent-coral text-accent-coral"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
              {count > 0 && (
                <span className="text-[10px] font-normal opacity-70">{count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {isSelf && tab === "shared"
            ? "Nothing yet. Pages other people share with you land here."
            : isSelf
              ? "Keep your own pages here — meeting prep, reading, anything. Private until you say otherwise."
              : `${ownerFirstName} hasn't published any pages.`}
        </p>
      ) : (
        <ul className="p-2 flex flex-col gap-0.5">
          {visible.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              showOwner={showOwner}
              favorited={favorites.has(note.id)}
              canManage={isSelf && tab === "mine"}
              onOpen={onOpenNote}
              onManage={setManaging}
            />
          ))}
        </ul>
      )}

      {managing && (
        <NoteShareModal
          note={managing}
          open
          onClose={() => setManaging(null)}
          onChanged={() => revalidator.revalidate()}
        />
      )}

      {fetcher.data && "error" in (fetcher.data as { error?: string }) && (
        <p className="px-4 pb-3 text-xs text-destructive">
          {(fetcher.data as { error: string }).error}
        </p>
      )}
    </aside>
  );
}
