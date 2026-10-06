// Contract state + send action for one partner application. Posts intent
// "contract-send" to the application detail route's action (core.partners.
// applications.$id.tsx) via the same fetch-based helper PropertyRail/
// StageActions use, so this mounts cleanly from either the full page or the
// modal. See app/partners/lib/partner-contract.server.ts for the server side
// (handleContractIntent, partnerContractStatus, listPartnerContractDocuments).

import { useState } from "react";
import { FileSignature, FileCheck2, Download } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";
import type { PartnerContractStatus } from "../../lib/partner-contract.server";

const STATE_LABEL: Record<PartnerContractStatus["state"], string> = {
  NotSent: "Not sent",
  Sent: "Sent",
  Signed: "Signed",
};

const STATE_PILL: Record<PartnerContractStatus["state"], string> = {
  NotSent: "bg-muted text-muted-foreground",
  Sent: "bg-accent-coral/15 text-accent-coral",
  Signed: "bg-accent-teal/15 text-accent-teal",
};

export function ContractPanel({
  applicationId,
  status,
  documents,
  canSend,
  onChanged,
}: {
  applicationId: string;
  status: PartnerContractStatus;
  /** PartnerContract-kind SigningDocuments with a published version — see listPartnerContractDocuments(). */
  documents: { id: string; title: string }[];
  canSend: boolean;
  onChanged?: () => void;
}) {
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!documentId) {
      setError("Choose a contract template to send.");
      return;
    }
    setSending(true);
    setError(null);
    const res = await postPartnerApplicationIntent(applicationId, "contract-send", { documentId });
    setSending(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't send the contract.");
      return;
    }
    onChanged?.();
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {status.state === "Signed" ? (
            <FileCheck2 className="h-4 w-4 text-accent-teal" />
          ) : (
            <FileSignature className="h-4 w-4 text-muted-foreground" />
          )}
          Contract
        </h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_PILL[status.state]}`}>
          {STATE_LABEL[status.state]}
        </span>
      </div>

      {status.state === "Signed" && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Signed {status.signedAt ? new Date(status.signedAt).toLocaleDateString() : ""}
          </span>
          {status.pdfUrl && (
            <a
              href={status.pdfUrl}
              className="inline-flex items-center gap-1 text-accent-coral hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> Download PDF
            </a>
          )}
        </div>
      )}

      {status.state === "Sent" && (
        <p className="text-sm text-muted-foreground">
          Waiting on the partner's signature.
        </p>
      )}

      {status.state === "NotSent" && canSend && (
        <div className="flex flex-col gap-2">
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No partner contract templates yet. Author one in Core ▸ Agreements
              and mark it "Partner contract template".
            </p>
          ) : (
            <>
              <Select
                value={documentId}
                onChange={setDocumentId}
                options={documents.map((d) => ({ value: d.id, label: d.title }))}
                placeholder="Choose a contract template…"
                buttonClassName="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => void send()}
                disabled={sending}
                className="self-start"
              >
                {sending ? "Sending…" : "Send contract"}
              </Button>
            </>
          )}
        </div>
      )}

      {status.state === "NotSent" && !canSend && (
        <p className="text-sm text-muted-foreground">No contract sent yet.</p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
