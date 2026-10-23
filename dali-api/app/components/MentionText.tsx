import { Fragment } from "react";

export type MentionPart = { text: string; handle?: string };

// Same token rule as MentionTextInput's typeahead: "@" at the start or after
// whitespace, so an email address ("a@b.edu") isn't read as a mention.
const MENTION = /(^|\s)@([a-z0-9_]+)/gi;

/** Split plain comment text into runs and "@handle" tokens. */
export function splitMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const at = m.index + m[1].length;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: `@${m[2]}`, handle: m[2].toLowerCase() });
    last = at + m[2].length + 1;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Plain comment text with its "@handle" tokens set off, for bodies written in MentionTextInput. */
export function MentionText({ text }: { text: string }) {
  return (
    <>
      {splitMentions(text).map((p, i) =>
        p.handle ? (
          <span key={i} className="font-semibold text-os-accent">
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}
