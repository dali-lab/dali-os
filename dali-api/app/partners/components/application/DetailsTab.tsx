// The modal's Details tab: what the property rail has no room for. The summary
// is editable inline (pencil → textarea → Save/Cancel); the rest is read-only.
// Terms, domains and team size are left to the rail so nothing shows twice.

import { useState } from "react";
import { Link } from "react-router";
import { Pencil } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";
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
  applicationId,
  summary,
  formAnswers,
  domains,
  canEdit,
  onChanged,
  limit,
  viewAllHref,
}: {
  applicationId: string;
  summary: string | null;
  formAnswers: FormAnswerRow[];
  domains: DomainRow[];
  canEdit: boolean;
  onChanged: () => void;
  /** Caps the form-answer rows (the modal's 8–10 row convention). Omit for the full page. */
  limit?: number;
  viewAllHref?: string;
}) {
  const shownAnswers = limit ? formAnswers.slice(0, limit) : formAnswers;
  const truncated = limit !== undefined && formAnswers.length > limit;

  return (
    <>
      <SummarySection
        applicationId={applicationId}
        summary={summary}
        canEdit={canEdit}
        onChanged={onChanged}
      />

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

function SummarySection({
  applicationId,
  summary,
  canEdit,
  onChanged,
}: {
  applicationId: string;
  summary: string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(summary ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = draft.trim();
    if (trimmed === (summary ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await postPartnerApplicationIntent(applicationId, "summary", { summary: trimmed });
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't save the summary.");
      return;
    }
    setEditing(false);
    onChanged();
  }

  const action =
    canEdit && !editing ? (
      <IconButton label="Edit summary" icon={Pencil} onClick={startEdit} />
    ) : undefined;

  return (
    <RailGroup title="Summary" action={action}>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            rows={4}
            aria-label="Internal summary"
            placeholder="A short synopsis for the lab. Partners don't see this."
            className="w-full rounded-xl bg-os-card px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-os-accent/40 disabled:opacity-60"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={() => void save()} disabled={saving}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {summary || <span className="text-os-grey">No summary yet</span>}
        </p>
      )}
    </RailGroup>
  );
}
