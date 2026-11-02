import { useState } from "react";
import { Link } from "react-router";
import { Smile, Meh, Frown } from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { Tooltip, InfoTip } from "~/components/ui/floating";
import { DocEditor } from "~/components/doc";
import { pageDocName } from "~/collab/roomName";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { VIBES, VIBE_META, type Vibe } from "../lib/vibe";

export type MentorNoteData = {
  id: string;
  pageId: string;
  weekOfIso: string;
  weekNumber: number | null;
  contentJson: unknown;
  vibe: Vibe | null;
  mentor: { id: string; firstName: string; lastName: string };
  mentee: { id: string; firstName: string; lastName: string; photoUrl?: string | null };
  projectName: string;
  termCode: string;
  domainDisplay: string;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
};

function fullName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`.trim();
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    // weekOf is a Monday at UTC midnight; local time would show Sunday in the US.
    timeZone: "UTC",
  });
}

const EDITOR_CLASS = "min-h-[24rem]";
// In the overlay the card supplies the gutter, so drop BlockNote's own 54px
// inline inset — the notes text then starts on the same edge as the title.
const OVERLAY_EDITOR_CLASS = "min-h-[16rem] [&_.bn-editor]:!px-0";

const VIBE_ICON = { Good: Smile, Ok: Meh, Bad: Frown } as const;

/**
 * The mentor-note body: title, date/author, vibe check, divider, free-text
 * notes. Shared by the full-page route and the overlay opened from the
 * mentorship grid, so the two can't drift.
 *
 * `variant="overlay"` renders inside a dialog card: no page-level panel
 * (the card is the surface), a close-aware title id, and even inline padding
 * so the header, vibe row, divider and editor share one left/right edge.
 */
export function MentorNoteView({
  data,
  variant = "page",
  titleId,
}: {
  data: MentorNoteData;
  variant?: "page" | "overlay";
  titleId?: string;
}) {
  const { pageTitle, bodyText, panel } = useOsChrome();
  const overlay = variant === "overlay";
  const [vibe, setVibe] = useState<Vibe | null>(data.vibe);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  // The vibe is a discrete choice, so persist it immediately (no debounce). It's
  // required (a note without one reads as "not filled in" on the grid), so
  // picking is one-way — clicking the active vibe again doesn't clear it.
  async function pickVibe(next: Vibe) {
    if (!data.canEdit || vibe === next) return;
    setVibe(next);
    setStatus("saving");
    try {
      const res = await fetch(`/api/mentorship/notes/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vibe: next }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  // Page: the vibe row aligns with the editor's 54px text inset. Overlay: the
  // card supplies the outer padding, so header, vibe row and editor all sit on
  // the card's own gutter.
  const editorClass = overlay ? OVERLAY_EDITOR_CLASS : EDITOR_CLASS;
  const rowPad = overlay ? "" : "px-3 sm:px-[54px]";

  const body = (
    <>
      <div className={cn("flex items-center gap-2 flex-wrap", rowPad)}>
        <span className={cn(bodyText, "inline-flex items-center gap-1")}>
          Vibe check
          <span className="os-required-mark" aria-hidden>
            *
          </span>
          <InfoTip content="How this week went. Excellent means things are going well, Room for improvement means something to work on, Concerning means it needs follow-up. Mentors and Core can see this, the mentee can't." />
          :
        </span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {VIBES.map((v) => {
            const Icon = VIBE_ICON[v];
            const active = vibe === v;
            const vibeButton = (
              <button
                key={v}
                type="button"
                onClick={() => pickVibe(v)}
                disabled={!data.canEdit}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border transition",
                  "px-3.5 py-1.5 text-sm font-medium",
                  active
                    ? VIBE_META[v].pill
                    : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
                  data.canEdit ? "" : "cursor-default opacity-70",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {VIBE_META[v].label}
              </button>
            );
            if (!data.canEdit) {
              return (
                <Tooltip
                  key={v}
                  content="Read only — only the mentor or Core can set the vibe."
                  variant="rich"
                >
                  {/* Disabled buttons don't fire hover events; span captures them. */}
                  <span>{vibeButton}</span>
                </Tooltip>
              );
            }
            return vibeButton;
          })}
        </div>
        <span className={cn(bodyText, "ml-auto")}>
          {!data.canEdit
            ? "Read only"
            : status === "saving"
            ? "Saving…"
            : status === "saved"
            ? "Saved"
            : status === "error"
            ? "Save failed, try again"
            : null}
        </span>
      </div>

      {/* Subtle rule between the structured vibe check and the free-text notes. */}
      <hr className={cn("border-0 border-t border-border/60", overlay ? "" : "mx-3 sm:mx-[54px]")} />

      {data.canEdit && data.collabToken ? (
        <DocEditor
          features="notes"
          collab={{
            documentName: pageDocName(data.pageId),
            token: data.collabToken,
            userName: data.userName,
          }}
          placeholder="What went well, what's blocked, what to follow up on…"
          className={editorClass}
        />
      ) : (
        <DocEditor
          features="notes"
          editable={false}
          initialContent={data.contentJson}
          className={editorClass}
        />
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4 w-full min-w-0">
      <header className="flex flex-col gap-1">
        {overlay ? (
          // Overlay header: the mentee is the title — photo left, name right,
          // centred on each other. The pr-10 keeps the name clear of the close button.
          <div className="flex items-center gap-3 pr-10">
            <Avatar
              photoUrl={data.mentee.photoUrl ?? null}
              name={fullName(data.mentee)}
              size="md"
            />
            <h1
              id={titleId}
              className="font-heading text-xl font-medium text-foreground min-w-0 truncate"
            >
              {fullName(data.mentee)}
            </h1>
          </div>
        ) : (
          <h1 id={titleId} className={pageTitle}>
            Notes on {fullName(data.mentee)}
          </h1>
        )}
        <p className="text-base text-os-grey">
          {data.weekNumber != null && `Week ${data.weekNumber} · `}
          {fmt(data.weekOfIso)}
          {" · "}
          <Link to={`/documents/${data.pageId}`} className="underline hover:text-foreground">
            Open in Drive
          </Link>
        </p>
        <p className={cn(bodyText, "inline-flex items-center gap-1")}>
          Author: {fullName(data.mentor)}
          <InfoTip content="Mentor notes are visible to all lab mentors and Core members — not to the mentee. Only the author or Core can edit a note." />
        </p>
      </header>

      {overlay ? (
        <div className="flex flex-col gap-4">{body}</div>
      ) : (
        <section className={cn(panel, "flex flex-col gap-4 py-6")}>{body}</section>
      )}
    </div>
  );
}
