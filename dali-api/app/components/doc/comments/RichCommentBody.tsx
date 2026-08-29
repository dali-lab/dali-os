// RichCommentBody — renders a comment body with @mention chips.
//
// When bodyJson is present (new comments), renders a flat sequence of text
// runs and mention chips. When bodyJson is null/undefined (legacy comments),
// renders body as plain text — preserving full backward-compatibility.
//
// Mention chips are styled like the doc-editor's coral mention chips:
//   rounded bg-accent-coral/15 px-1 py-0.5 font-medium text-accent-coral
// They are not clickable (no profile page exists to navigate to from here).

import type { BodySegment } from "~/lib/comment-body";

interface RichCommentBodyProps {
  /** Structured body segments (present on new comments). */
  bodyJson?: BodySegment[] | null;
  /** Plain-text fallback (always present; used when bodyJson is absent). */
  body: string;
  className?: string;
}

export function RichCommentBody({ bodyJson, body, className = "" }: RichCommentBodyProps) {
  if (!bodyJson || bodyJson.length === 0) {
    // Legacy comment: render plain text preserving line breaks.
    return (
      <p className={`whitespace-pre-wrap text-[15px] text-foreground ${className}`}>{body}</p>
    );
  }

  return (
    <p className={`whitespace-pre-wrap text-[15px] text-foreground ${className}`}>
      {bodyJson.map((segment, i) => {
        if (segment.type === "mention") {
          return (
            <span
              key={i}
              className="rounded bg-accent-coral/15 px-1 py-0.5 font-medium text-accent-coral"
              aria-label={`Mention: @${segment.label}`}
            >
              @{segment.label}
            </span>
          );
        }
        return <span key={i}>{segment.text}</span>;
      })}
    </p>
  );
}
