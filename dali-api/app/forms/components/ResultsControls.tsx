import { Download } from "lucide-react";
import { Segmented } from "~/components/ui/Segmented";
import { buttonClasses } from "~/components/ui/Button";
import { Tooltip } from "~/components/ui/floating";

export type ResultsView = "questions" | "summary" | "responses";

export function resultsViewParams(
  searchParams: URLSearchParams,
  view: ResultsView,
  versionNumber: number,
): URLSearchParams {
  if (view === "questions") return new URLSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set("view", "results");
  if (!next.has("version")) next.set("version", String(versionNumber));
  next.delete("page");
  if (view === "responses") next.set("show", "responses");
  else next.delete("show");
  return next;
}

export function ResultsSwitch({
  view,
  responseCount,
  byline,
  onChange,
}: {
  view: ResultsView;
  responseCount: number;
  byline: string;
  onChange: (view: ResultsView) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Segmented
        ariaLabel="Form view"
        value={view}
        onChange={onChange}
        options={[
          { value: "questions", label: "Questions" },
          { value: "summary", label: "Summary" },
          { value: "responses", label: "Responses", count: responseCount },
        ]}
      />
      <span className="text-xs text-muted-foreground">{byline}</span>
    </div>
  );
}

export function exportCsvHref(
  formId: string,
  versionNumber: number,
  searchParams: URLSearchParams,
  { search = true }: { search?: boolean } = {},
): string {
  const out = new URLSearchParams({ version: String(versionNumber) });
  const q = search ? (searchParams.get("q") ?? "").trim() : "";
  if (q) out.set("q", q);
  const slot = searchParams.get("slot");
  if (slot) out.set("slot", slot);
  for (const entry of searchParams.getAll("a")) out.append("a", entry);
  return `/forms/responses/${formId}/export.csv?${out}`;
}

export function ExportCsvLink({
  formId,
  versionNumber,
  searchParams,
  matching,
  search = true,
}: {
  formId: string;
  versionNumber: number;
  searchParams: URLSearchParams;
  // Set when a search or filter is on: how many responses the file will hold.
  matching?: number;
  search?: boolean;
}) {
  return (
    <CsvLink
      href={exportCsvHref(formId, versionNumber, searchParams, { search })}
      matching={matching}
      allTip="Export every response to this version as CSV"
    />
  );
}

export function CsvLink({
  href,
  matching,
  allTip,
}: {
  href: string;
  matching?: number;
  allTip: string;
}) {
  return (
    <Tooltip
      content={
        matching === undefined
          ? allTip
          : "Export the responses that match the current search and filters as CSV"
      }
    >
      <a href={href} download className={buttonClasses("secondary", "sm", "h-8")}>
        <Download className="h-4 w-4" aria-hidden />
        {matching === undefined ? "Export" : `Export ${matching}`}
      </a>
    </Tooltip>
  );
}
