import { Download } from "lucide-react";
import { Tooltip } from "./IconButton";
import { cn } from "~/lib/cn";

export interface ExportCsvButtonProps {
  /** Must match a CsvExportDefinition id registered in a "lib/csv-exports.server.ts" file. */
  exportId: string;
  /** Forwarded as query params to the export route (filters, scoping ids, etc). */
  params?: Record<string, string | undefined>;
  label?: string;
  className?: string;
}

// Shared download link for the generalized CSV export mechanism
// (app/lib/csv-export.server.ts). Styling matches the export link already
// used on the Forms Responses page so every "Export CSV" affordance in the
// app looks identical, old or new.
export function ExportCsvButton({
  exportId,
  params,
  label = "Export CSV",
  className,
}: ExportCsvButtonProps) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") qs.set(key, value);
  }
  const query = qs.toString();
  const href = `/api/export/${encodeURIComponent(exportId)}/export.csv${query ? `?${query}` : ""}`;

  return (
    <Tooltip label={label}>
      <a
        href={href}
        download
        aria-label={label}
        className={cn(
          "inline-flex items-center justify-center p-1.5 text-sm font-medium rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap",
          className,
        )}
      >
        <Download className="w-4 h-4" aria-hidden />
      </a>
    </Tooltip>
  );
}
