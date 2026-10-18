// The modal's Details tab: what the property rail has no room for, read-only.
// Terms, domains and team size are left to the rail so nothing shows twice.

import { Link } from "react-router";
import { RailGroup } from "./rail";

type FormAnswerRow = { key: string; label: string; value: string };
type DomainRow = {
  id: string;
  domainName: string;
  expectedMembers: number;
  expectedChallenges: unknown;
};

// expectedChallenges is a BlockNote block array. A short plain-text excerpt is
// enough here (the full editor lives on the full page) — walk each block's
// inline content and join the text runs.
function blocksExcerpt(blocks: unknown, maxLen = 160): string | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const parts: string[] = [];
  for (const block of blocks) {
    const content = (block as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const run of content) {
      const text = (run as { text?: unknown })?.text;
      if (typeof text === "string") parts.push(text);
    }
  }
  const joined = parts.join(" ").trim();
  if (!joined) return null;
  return joined.length > maxLen ? `${joined.slice(0, maxLen)}…` : joined;
}

export function DetailsTab({
  summary,
  formAnswers,
  domains,
  limit,
  viewAllHref,
}: {
  summary: string | null;
  formAnswers: FormAnswerRow[];
  domains: DomainRow[];
  /** Caps the form-answer rows (the modal's 8–10 row convention). Omit for the full page. */
  limit?: number;
  viewAllHref?: string;
}) {
  const shownAnswers = limit ? formAnswers.slice(0, limit) : formAnswers;
  const truncated = limit !== undefined && formAnswers.length > limit;

  return (
    <>
      <RailGroup title="Summary">
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {summary || <span className="text-os-grey">No summary yet</span>}
        </p>
      </RailGroup>

      {domains.length > 0 && (
        <RailGroup title="Domain scope">
          <div className="flex flex-col gap-2">
            {domains.map((d) => (
              <div key={d.id}>
                <p className="text-sm font-medium text-foreground">{d.domainName}</p>
                <p className="text-sm text-os-grey">{blocksExcerpt(d.expectedChallenges) ?? "Not described yet"}</p>
              </div>
            ))}
          </div>
        </RailGroup>
      )}

      {formAnswers.length > 0 && (
        <RailGroup title="Answers">
          <div className="flex flex-col gap-3">
            {shownAnswers.map((row) => (
              <div key={row.key}>
                <p className="mb-0.5 text-sm text-os-grey">{row.label}</p>
                <p className="whitespace-pre-wrap text-sm text-foreground">{row.value || "—"}</p>
              </div>
            ))}
          </div>
          {truncated && viewAllHref && (
            <Link to={viewAllHref} className="inline-block text-sm font-medium text-os-accent hover:underline">
              View all {formAnswers.length} answers
            </Link>
          )}
        </RailGroup>
      )}
    </>
  );
}
