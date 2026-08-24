import { useState } from "react";
import { useRevalidator } from "react-router";
import { FileSignature } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

// One preview row from GET /api/agreements/issue (kept in step with
// IssuablePreview in signing/lib/issue.server.ts — that file is server-only).
type IssuePreviewItem = {
  documentId: string;
  documentName: string;
  recipientCount: number;
  recipientNames: string[];
  alreadyInForce: boolean;
};

// Core-only bulk "issue this term's agreements" control, shared by the staffing
// board (where staffing is finalized) and the Core ▸ Agreements hub. Previews
// each agreement + exactly who it reaches before sending (issuance is never
// silent), reminds Core to finalize staffing first, and notes re-issuing only
// nudges still-unsigned members. Revalidates so the caller's view refreshes.
export function IssueTermAgreementsButton({
  termId,
  label = "Issue term agreements",
  variant = "secondary",
  className,
}: {
  termId: string;
  label?: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const { confirm } = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch(`/api/agreements/issue?termId=${encodeURIComponent(termId)}`, {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        termCode?: string | null;
        items?: IssuePreviewItem[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't load agreements.");
        return;
      }
      const items = data.items ?? [];
      const forTerm = data.termCode ? ` for ${data.termCode}` : "";
      if (items.length === 0) {
        toast.info(`No recurring agreements to issue${forTerm}.`);
        return;
      }
      const ok = await confirm({
        title: `Issue term agreements${forTerm}?`,
        description: (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Finalize all project staffing{forTerm} first — recipients are drawn from the staffed
              roster, so anyone not yet staffed won't be included. Safe to run again afterward:
              re-issuing only notifies people who still haven't signed.
            </p>
            <p>Each agreement is put in force and sent a sign request:</p>
            <ul className="space-y-2">
              {items.map((i) => (
                <li key={i.documentId}>
                  <div>
                    <span className="font-medium">{i.documentName}</span> →{" "}
                    {i.recipientCount} {i.recipientCount === 1 ? "person" : "people"}
                    {i.alreadyInForce ? " (re-issue)" : ""}
                  </div>
                  {i.recipientNames.length > 0 ? (
                    <div className="mt-0.5 max-h-24 overflow-auto text-xs text-muted-foreground">
                      {i.recipientNames.join(", ")}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs italic text-muted-foreground">
                      No one to notify yet.
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ),
        confirmLabel: "Send",
      });
      if (!ok) return;
      const post = await fetch("/api/agreements/issue", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentIds: items.map((i) => i.documentId), termId }),
      });
      const result = (await post.json().catch(() => ({}))) as { issued?: number; error?: string };
      if (!post.ok) {
        toast.error(result.error ?? "Failed to issue agreements.");
        return;
      }
      const n = result.issued ?? 0;
      toast.success(`Issued ${n} agreement${n === 1 ? "" : "s"}.`);
      revalidator.revalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={variant}
      size="sm"
      onClick={() => void onClick()}
      disabled={busy}
      className={className}
    >
      <FileSignature className="w-4 h-4" /> {busy ? "Issuing…" : label}
    </Button>
  );
}
