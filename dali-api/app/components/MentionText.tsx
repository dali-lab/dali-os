import { segmentBody, type MentionMatch } from "~/lib/mentions";

/**
 * Render plain-text body with @-mentions visually chipped. Pass
 * `resolved` when you want chips to display the canonical name; omit it
 * to just regex-highlight raw @handles. Preserves whitespace.
 */
export function MentionText({
  body,
  resolved = [],
  className = "text-sm text-dark-blue whitespace-pre-wrap",
}: {
  body: string;
  resolved?: MentionMatch[];
  className?: string;
}) {
  const segments = segmentBody(body, resolved);
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.type === "mention" ? (
          <span key={i} className="text-accent-coral font-semibold">{s.text}</span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}
