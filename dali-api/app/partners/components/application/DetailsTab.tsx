// Details tab, shared by PartnerApplicationModal and the full page: a read
// display of the pitch summary, the partner's form answers, domain scope,
// and target terms. Editing these fields happens through PropertyRail (terms,
// domains) or the full page's own forms (summary, challenges) — this tab is
// deliberately read-only so it can render identically in both places.

import { Link } from "react-router";

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
  targetTerms,
  limit,
  viewAllHref,
}: {
  summary: string | null;
  formAnswers: FormAnswerRow[];
  domains: DomainRow[];
  targetTerms: { id: string; code: string }[];
  /** Caps the form-answer rows (the modal's 8–10 row convention). Omit for the full page. */
  limit?: number;
  viewAllHref?: string;
}) {
  const shownAnswers = limit ? formAnswers.slice(0, limit) : formAnswers;
  const truncated = limit !== undefined && formAnswers.length > limit;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pitch summary
        </h3>
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {summary || <span className="italic text-muted-foreground">No summary yet.</span>}
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Target terms
        </h3>
        {targetTerms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No target terms.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {targetTerms.map((t) => (
              <span key={t.id} className="rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground">
                {t.code}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Domains
        </h3>
        {domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">No domains scoped yet.</p>
        ) : (
          <dl className="flex flex-col gap-2">
            {domains.map((d) => {
              const excerpt = blocksExcerpt(d.expectedChallenges);
              return (
                <div key={d.id}>
                  <dt className="text-sm font-medium text-foreground">
                    {d.domainName}
                    {d.expectedMembers > 0 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        · {d.expectedMembers} expected
                      </span>
                    )}
                  </dt>
                  {excerpt && <dd className="text-xs text-muted-foreground">{excerpt}</dd>}
                </div>
              );
            })}
          </dl>
        )}
      </section>

      {formAnswers.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Application answers
          </h3>
          <dl className="flex flex-col gap-3">
            {shownAnswers.map((row) => (
              <div key={row.key}>
                <dt className="mb-0.5 text-xs font-medium text-muted-foreground">{row.label}</dt>
                <dd className="whitespace-pre-wrap text-sm text-foreground">{row.value || "—"}</dd>
              </div>
            ))}
          </dl>
          {truncated && viewAllHref && (
            <Link to={viewAllHref} className="mt-2 inline-block text-xs font-medium text-accent-coral hover:underline">
              View all {formAnswers.length} answers →
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
