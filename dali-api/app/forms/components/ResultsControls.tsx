import { Download } from "lucide-react";
import { Tooltip } from "~/components/ui/floating";
import { cn } from "~/lib/cn";

export type ResultsTab = "summary" | "responses";

const TABS: { value: ResultsTab; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "responses", label: "Responses" },
];

export function setResultsTab(
  searchParams: URLSearchParams,
  tab: ResultsTab,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete("page");
  if (tab === "responses") next.set("show", "responses");
  else next.delete("show");
  return next;
}

export function ResultsViewToggle({
  value,
  onChange,
}: {
  value: ResultsTab;
  onChange: (tab: ResultsTab) => void;
}) {
  return (
    <div className="inline-flex p-1 rounded-full bg-os-container">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          aria-pressed={value === tab.value}
          className={cn(
            "px-4 py-1.5 rounded-full text-sm font-semibold transition-colors",
            value === tab.value
              ? "bg-os-card text-foreground shadow-sm"
              : "text-os-grey hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
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
  const label = matching === undefined ? "Export CSV" : `Export ${matching} matching`;
  return (
    <Tooltip
      content={
        matching === undefined
          ? "Export every response to this version as CSV"
          : "Export the responses that match the current search and filters as CSV"
      }
    >
      <a
        href={exportCsvHref(formId, versionNumber, searchParams, { search })}
        download
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full border border-os-container text-os-grey hover:text-foreground hover:border-os-container-hi transition-colors",
          matching === undefined ? "p-2" : "px-3 py-1.5 text-sm",
        )}
      >
        <Download className="w-4 h-4" />
        {matching !== undefined && label}
      </a>
    </Tooltip>
  );
}
