import { useState } from "react";
import { Form } from "react-router";
import { ChevronRight, CheckCircle } from "lucide-react";

export function ConfidentialityAgreementPicker({
  currentBinding,
  agreementOptions,
  signatures,
}: {
  currentBinding: any | null;
  agreementOptions: any[];
  signatures: { user: { firstName: string | null; lastName: string | null } }[];
}) {
  const [editing, setEditing] = useState(!currentBinding);
  const [signersOpen, setSignersOpen] = useState(false);
  const currentName =
    currentBinding?.confidentialityAgreementVersion?.agreement?.name ?? null;
  const currentVersion =
    currentBinding?.confidentialityAgreementVersion?.versionNumber ?? null;
  const signatureCount = signatures.length;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-3">
      <h3 className="text-sm font-bold text-foreground/80">
        Confidentiality Agreement
      </h3>
      <p className="text-xs text-muted-foreground">
        Reviewers, interviewers, domain leads, and admins must sign this
        agreement before viewing sensitive data for the cycle. If unset, nobody
        — including you — can see submitted applications, reviews, interviews,
        notes, or decisions.
      </p>
      {!currentBinding && !editing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No agreement bound — sensitive cycle data is hidden from everyone.
        </div>
      )}
      {currentBinding && !editing ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span>
                {currentName ?? "Set"} — v{currentVersion}
              </span>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              Change
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSignersOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={`w-3 h-3 transition-transform ${signersOpen ? "rotate-90" : ""}`}
            />
            {signatureCount} signature{signatureCount === 1 ? "" : "s"}
          </button>
          {signersOpen && (
            <ul className="ml-4 space-y-1">
              {signatures.length === 0 ? (
                <li className="text-xs text-muted-foreground italic">
                  No one has signed yet.
                </li>
              ) : (
                signatures.map((sig, i) => {
                  const name =
                    `${sig.user.firstName ?? ""} ${sig.user.lastName ?? ""}`.trim() ||
                    "Unknown";
                  return (
                    <li key={i} className="text-xs text-foreground/80">
                      {name}
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      ) : (
        <Form
          method="post"
          className="flex items-end gap-3"
          onSubmit={() => setEditing(false)}
        >
          <input
            type="hidden"
            name="intent"
            value="set-confidentiality-agreement"
          />
          <div className="flex-1">
            <select
              name="confidentialityAgreementVersionId"
              defaultValue={
                currentBinding?.confidentialityAgreementVersionId ?? ""
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No agreement bound</option>
              {agreementOptions.map((a: any) =>
                (a.versions ?? []).map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {a.name} — v{v.versionNumber}
                  </option>
                )),
              )}
            </select>
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition"
          >
            Save
          </button>
          {currentBinding && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </Form>
      )}
    </div>
  );
}
