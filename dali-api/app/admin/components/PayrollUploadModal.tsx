import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { FileSpreadsheet, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";
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
  const { actionBtnPrimary } = useOsChrome();
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
        title="Import TimesheetX export"
        subtitle="Pay periods are detected from the file."
        onClose={onClose}
      />

      <fetcher.Form
        ref={formRef}
        method="post"
        action="/admin/payroll/upload"
        encType="multipart/form-data"
        onSubmit={handleSubmit}
      >
        <p className="text-sm text-os-grey">
          Entries are matched to staffing by NetID and job.
        </p>
        <DropZone
          name="timesheet"
          required
          label="Timesheet CSV"
          hint="Required"
          icon={<FileSpreadsheet className="h-6 w-6 text-os-accent" aria-hidden />}
          className="mt-4"
        />
        <DropZone
          name="notes"
          label="Notes CSV"
          hint="Optional"
          icon={<FileText className="h-5 w-5 text-os-grey" aria-hidden />}
          className="mt-3"
          compact
        />

        <p className="mt-3 text-xs text-os-muted">
          {MAX_UPLOAD_LABEL} max. Ingest replaces each pay period, so uploading
          the same file again is safe.
        </p>

        {(clientError || serverError) && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-os-item bg-destructive/10 px-3 py-2 text-xs text-destructive"
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
            className={cn(actionBtnPrimary, "disabled:opacity-50")}
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
    <div className="mt-4 rounded-os-item bg-os-well px-3.5 py-3 text-xs text-foreground">
      <div className="flex items-center gap-1.5 font-semibold text-os-green">
        <CheckCircle2 className="w-4 h-4" aria-hidden /> Import complete
      </div>
      <ul className="mt-1.5 space-y-0.5 text-os-grey">
        <li>
          {timesheet.periods.length} pay period
          {timesheet.periods.length === 1 ? "" : "s"} · {created} created ·{" "}
          {skipped} duplicates skipped · {deleted} prior rows replaced
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
          <li className="text-os-amber">
            {timesheet.invalidPeriods.length} pay-period label
            {timesheet.invalidPeriods.length === 1 ? "" : "s"} could not be parsed
            and {timesheet.invalidPeriods.length === 1 ? "was" : "were"} skipped.
          </li>
        )}
        {rowErrors > 0 && (
          <li className="text-os-amber">
            {rowErrors} row{rowErrors === 1 ? "" : "s"} had errors and{" "}
            {rowErrors === 1 ? "was" : "were"} skipped.
          </li>
        )}
      </ul>
    </div>
  );
}

// The file input covers the whole zone (transparent), so both clicking and
// dropping a file land on the native input.
function DropZone({
  name,
  label,
  hint,
  icon,
  required,
  compact,
  className,
}: {
  name: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  required?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-1.5 rounded-os-item border border-dashed bg-os-well px-4 text-center text-sm transition-colors focus-within:border-os-accent",
        compact ? "py-4" : "py-8",
        over ? "border-os-accent text-foreground" : "border-os-container-hi text-os-grey hover:border-os-accent hover:text-foreground",
        className,
      )}
    >
      {icon}
      <span className="font-semibold text-foreground">
        {label} <span className="font-normal text-os-muted">({hint.toLowerCase()})</span>
      </span>
      <span className="text-xs">{fileName ?? "Choose a CSV or drop it here"}</span>
      <input
        type="file"
        name={name}
        accept=".csv"
        required={required}
        aria-label={`${label} (${hint.toLowerCase()})`}
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
