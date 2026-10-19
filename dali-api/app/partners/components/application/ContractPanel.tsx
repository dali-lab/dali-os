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
import { Pill, type PillTone } from "~/hiring/components/cycle-setup/SetupCard";
import { postPartnerApplicationIntent } from "../../lib/partner-detail-fetch";
import type { PartnerContractStatus } from "../../lib/partner-contract.server";
import { RAIL_CONTROL, RAIL_LINK } from "./rail";

const STATE_LABEL: Record<PartnerContractStatus["state"], string> = {
  NotSent: "Not sent",
  Sent: "Sent",
  Signed: "Signed",
};

const STATE_TONE: Record<PartnerContractStatus["state"], PillTone> = {
  NotSent: "neutral",
  Sent: "accent",
  Signed: "success",
};

export function ContractPanel({
  applicationId,
  status,
  documents,
  canSend,
  onChanged,
  compact = false,
}: {
  applicationId: string;
  status: PartnerContractStatus;
  /** PartnerContract-kind SigningDocuments with a published version — see listPartnerContractDocuments(). */
  documents: { id: string; title: string }[];
  canSend: boolean;
  onChanged?: () => void;
  /** Chip + a document Select/Send or signed date/PDF link, no header — for the property rail. */
  compact?: boolean;
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

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill dot={STATE_TONE[status.state]}>{STATE_LABEL[status.state]}</Pill>
          {status.state === "Signed" && status.pdfUrl && (
            <a href={status.pdfUrl} className={`inline-flex items-center gap-1 ${RAIL_LINK}`}>
              <Download className="h-3.5 w-3.5" aria-hidden /> PDF
            </a>
          )}
        </div>
        {status.state === "Signed" && status.signedAt && (
          <span className="text-xs text-os-grey">
            Signed {new Date(status.signedAt).toLocaleDateString()}
          </span>
        )}
        {status.state === "Sent" && (
          <span className="text-xs text-os-grey">Waiting on the partner's signature.</span>
        )}
        {status.state === "NotSent" && canSend && (
          documents.length === 0 ? (
            <p className="text-xs text-os-grey">No contract templates yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <Select
                value={documentId}
                onChange={setDocumentId}
                options={documents.map((d) => ({ value: d.id, label: d.title }))}
                placeholder="Choose a template"
                ariaLabel="Contract template"
                buttonClassName={RAIL_CONTROL}
              />
              <Button
                variant="secondary"
                size="xs"
                onClick={() => void send()}
                disabled={sending}
                className="self-start"
              >
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          )
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          {status.state === "Signed" ? (
            <FileCheck2 className="h-4 w-4 text-os-green" />
          ) : (
            <FileSignature className="h-4 w-4 text-muted-foreground" />
          )}
          Contract
        </h2>
        <Pill dot={STATE_TONE[status.state]}>{STATE_LABEL[status.state]}</Pill>
      </div>

      {status.state === "Signed" && (
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            Signed {status.signedAt ? new Date(status.signedAt).toLocaleDateString() : ""}
          </span>
          {status.pdfUrl && (
            <a
              href={status.pdfUrl}
              className={`inline-flex items-center gap-1 ${RAIL_LINK}`}
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
