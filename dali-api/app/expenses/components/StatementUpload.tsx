import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Field } from "~/components/ui/modal-fields";
import { Toggle } from "~/components/ui/Toggle";
import { Select } from "~/components/ui/floating";
import { readStatementHeaders } from "../lib/statement-csv";
import type { ImportSummaryView } from "./types";

export type Mapping = { date: string; merchant: string; amount: string; invertSign: boolean };

export function mappingReady(headers: string[], m: Mapping): boolean {
  const cols = [m.date, m.merchant, m.amount];
  return cols.every((c) => headers.includes(c)) && new Set(cols).size === 3;
}

export function importFields(cardId: string, csv: string, m: Mapping): Record<string, string> {
  return { cardId, csv, date: m.date, merchant: m.merchant, amount: m.amount, ...(m.invertSign ? { invertSign: "1" } : {}) };
}

export function StatementUpload({
  cardId,
  busy,
  error,
  summary,
  onImport,
}: {
  cardId: string;
  busy: boolean;
  error: string | null;
  summary: ImportSummaryView | null;
  onImport: (fields: Record<string, string>) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ date: "", merchant: "", amount: "", invertSign: false });

  const load = async (file: File) => {
    setReadError(null);
    const text = await file.text();
    const found = readStatementHeaders(text);
    if (found.length === 0) {
      setCsv(null);
      setHeaders([]);
      setReadError("That file doesn't look like a CSV with a header row.");
      return;
    }
    setCsv(text);
    setFileName(file.name);
    setHeaders(found);
    setMapping({ date: "", merchant: "", amount: "", invertSign: false });
  };

  const options = headers.map((h) => ({ value: h, label: h }));
  return (
    <section className="flex flex-col gap-3" aria-label="Upload a statement">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={picker}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Choose statement file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void load(f);
          }}
        />
        <Button variant="secondary" onClick={() => picker.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden /> Upload statement
        </Button>
        <span className="text-sm text-os-grey">{csv ? fileName : "Export the card's transactions as a CSV, then upload it here."}</span>
      </div>
      {csv && (
        <div className="os-form flex flex-wrap items-end gap-3">
          <Field label="Date column">
            <Select ariaLabel="Date column" value={mapping.date} onChange={(v) => setMapping({ ...mapping, date: v })} options={options} placeholder="Choose" />
          </Field>
          <Field label="Merchant column">
            <Select ariaLabel="Merchant column" value={mapping.merchant} onChange={(v) => setMapping({ ...mapping, merchant: v })} options={options} placeholder="Choose" />
          </Field>
          <Field label="Amount column">
            <Select ariaLabel="Amount column" value={mapping.amount} onChange={(v) => setMapping({ ...mapping, amount: v })} options={options} placeholder="Choose" />
          </Field>
          <Toggle label="Amounts are negative for charges" checked={mapping.invertSign} onChange={(e) => setMapping({ ...mapping, invertSign: e.target.checked })} />
          <Button disabled={busy || !mappingReady(headers, mapping)} onClick={() => onImport(importFields(cardId, csv, mapping))}>
            Import
          </Button>
        </div>
      )}
      {(readError || error) && (
        <p role="alert" className="text-sm text-destructive">
          {readError ?? error}
        </p>
      )}
      {summary && (
        <p role="status" className="text-sm text-foreground">
          Imported {summary.imported}, skipped {summary.skipped} already there. {summary.matched} matched, {summary.needsReceipt} need a receipt
          {summary.ambiguous > 0 ? `, ${summary.ambiguous} need you to pick` : ""}.
          {summary.errors.length > 0 ? ` ${summary.errors.length} rows couldn't be read.` : ""}
        </p>
      )}
    </section>
  );
}
