import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { fileMatchesAccept, MAX_UPLOAD_LABEL } from "~/lib/file-validation";
import type {
  PayrollUploadResult,
  PayrollUploadError,
} from "~/admin/routes/admin.payroll.upload";

type Action = PayrollUploadResult | PayrollUploadError;

const TITLE_ID = "payroll-upload-title";

export function PayrollUploadModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const fetcher = useFetcher<Action>();
  const revalidator = useRevalidator();
  const formRef = useRef<HTMLFormElement>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const submitting = fetcher.state !== "idle";
  const result = fetcher.data;

  // On a successful import, refresh the page loader so the tabs populate.
  useEffect(() => {
    if (fetcher.state === "idle" && result && result.ok) {
      revalidator.revalidate();
    }
  }, [fetcher.state, result, revalidator]);

  // Reset transient state each time the modal reopens.
  useEffect(() => {
    if (open) setClientError(null);
  }, [open]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    setClientError(null);
    const form = e.currentTarget;
    const timesheet = form.elements.namedItem("timesheet") as HTMLInputElement | null;
    const notes = form.elements.namedItem("notes") as HTMLInputElement | null;

    const tsFile = timesheet?.files?.[0];
    if (!tsFile) {
      e.preventDefault();
      setClientError("Choose a timesheet CSV to upload.");
      return;
    }
    if (!fileMatchesAccept(tsFile.name, tsFile.type, ".csv")) {
      e.preventDefault();
      setClientError("The timesheet must be a .csv file.");
      return;
    }
    const notesFile = notes?.files?.[0];
    if (notesFile && !fileMatchesAccept(notesFile.name, notesFile.type, ".csv")) {
      e.preventDefault();
      setClientError("The notes file must be a .csv file.");
      return;
    }
    // Let the fetcher.Form submit as multipart (encType set on the form).
  }

  const serverError = result && !result.ok ? result.error : null;

  return (
    <Modal open={open} onClose={onClose} labelledBy={TITLE_ID} disableEscape={submitting}>
      <ModalHeader
        titleId={TITLE_ID}
        title="Upload timesheet CSV"
        subtitle="TimesheetX export — pay periods are detected from the file."
        onClose={onClose}
      />

      <fetcher.Form
        ref={formRef}
        method="post"
        action="/admin/payroll/upload"
        encType="multipart/form-data"
        onSubmit={handleSubmit}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" aria-hidden /> Timesheet CSV (required)
          </span>
          <input
            type="file"
            name="timesheet"
            accept=".csv"
            required
            className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-border"
          />
        </label>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" aria-hidden /> Notes CSV (optional)
          </span>
          <input
            type="file"
            name="notes"
            accept=".csv"
            className="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-border"
          />
        </label>

        <p className="mt-2 text-[11px] text-muted-foreground">
          {MAX_UPLOAD_LABEL} max. Ingest replaces each pay period — re-uploading
          the same file is safe.
        </p>

        {(clientError || serverError) && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
            <span>{clientError ?? serverError}</span>
          </div>
        )}

        {result && result.ok && <ImportSummary result={result} />}

        <ModalFooter onCancel={onClose} cancelLabel={result?.ok ? "Close" : "Cancel"}>
          <button
            type="submit"
            disabled={submitting}
            className={buttonClasses("primary", "sm")}
          >
            {submitting ? "Uploading…" : "Upload"}
          </button>
        </ModalFooter>
      </fetcher.Form>
    </Modal>
  );
}

function ImportSummary({ result }: { result: PayrollUploadResult }) {
  const { timesheet, notes } = result;
  const created = timesheet.periods.reduce((s, p) => s + p.rowsCreated, 0);
  const skipped = timesheet.periods.reduce((s, p) => s + p.rowsSkippedDuplicates, 0);
  const deleted = timesheet.periods.reduce((s, p) => s + p.rowsDeletedPrior, 0);
  const rowErrors = timesheet.rowErrors.length + (notes?.rowErrors.length ?? 0);

  return (
    <div className="mt-4 rounded-md bg-muted px-3 py-2.5 text-xs text-foreground">
      <div className="flex items-center gap-1.5 font-semibold text-accent-green">
        <CheckCircle2 className="w-4 h-4" aria-hidden /> Import complete
      </div>
      <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
        <li>
          {timesheet.periods.length} pay period
          {timesheet.periods.length === 1 ? "" : "s"} · {created} created ·{" "}
          {skipped} duplicate-skipped · {deleted} deleted-prior
        </li>
        {notes && (
          <li>
            Notes: {notes.periodsUpdated} period
            {notes.periodsUpdated === 1 ? "" : "s"} updated
            {notes.skippedUnknownPeriods > 0 &&
              ` · ${notes.skippedUnknownPeriods} skipped (unknown period)`}
          </li>
        )}
        {timesheet.invalidPeriods.length > 0 && (
          <li className="text-amber-700">
            {timesheet.invalidPeriods.length} pay-period label
            {timesheet.invalidPeriods.length === 1 ? "" : "s"} could not be parsed
            and {timesheet.invalidPeriods.length === 1 ? "was" : "were"} skipped.
          </li>
        )}
        {rowErrors > 0 && (
          <li className="text-amber-700">
            {rowErrors} row{rowErrors === 1 ? "" : "s"} had errors and{" "}
            {rowErrors === 1 ? "was" : "were"} skipped.
          </li>
        )}
      </ul>
    </div>
  );
}
