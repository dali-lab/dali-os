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

export function ExportCsvLink({
  formId,
  versionNumber,
}: {
  formId: string;
  versionNumber: number;
}) {
  return (
    <Tooltip content="Export every response to this version as CSV">
      <a
        href={`/forms/responses/${formId}/export.csv?version=${versionNumber}`}
        download
        aria-label="Export CSV"
        className="inline-flex items-center justify-center p-2 rounded-full border border-os-container text-os-grey hover:text-foreground hover:border-os-container-hi transition-colors"
      >
        <Download className="w-4 h-4" />
      </a>
    </Tooltip>
  );
}
