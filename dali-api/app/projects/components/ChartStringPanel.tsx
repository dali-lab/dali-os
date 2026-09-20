/* Payroll chart strings for a project, per term, with history.
 *
 * Replaces the two free-text inputs this panel grew out of. Those accepted
 * anything — which is how a `tel:`-autolinked value and a three-segment
 * truncation reached production — and had nowhere to put a second string or a
 * predecessor. Every save here runs the same validator as the MCP tool and
 * appends a row rather than overwriting, so a superseded string stays readable.
 *
 * Core-only. The rows never reach a non-Core payload at all (the loader sends
 * an empty list), so there is nothing here to hide client-side. */

import { useState } from "react";
import { useFetcher } from "react-router";
import { Info, Plus, History, AlertTriangle } from "lucide-react";
import { cn } from "~/lib/cn";
import { GL_SUBACTIVITIES } from "~/lib/chart-string";

export type ChartStringRowView = {
  id: string;
  termId: string;
  termCode: string;
  normalized: string;
  type: "GL" | "PTAEO";
  projectCode: string;
  subactivity: string | null;
  org: string | null;
  awardCode: string | null;
  fpNumber: string | null;
  awardId: string | null;
  rapportName: string | null;
  kind: "ADVANCE" | "FUNDED" | "DEPARTMENT";
  isCurrent: boolean;
  supersedeReason: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

const KIND_LABEL: Record<ChartStringRowView["kind"], string> = {
  ADVANCE: "Advance account",
  FUNDED: "Funded award",
  DEPARTMENT: "Departmental GL",
};

const field =
  "w-full rounded-os-input border border-os-container bg-os-input px-3 py-2 text-sm text-foreground placeholder:text-os-grey";

/** A chart string, dot-separated, with the segment that identifies the project
 *  picked out — GL puts it fourth (Activity), PTAEO first (Project). Seeing
 *  which segment carries the identity is most of understanding the string. */
function ChartString({ value, type }: { value: string; type: "GL" | "PTAEO" }) {
  const segments = value.split(".");
  const keyIndex = type === "GL" ? 3 : 0;
  return (
    <span className="break-all font-mono text-xs">
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 && <span className="text-os-grey">.</span>}
          <span className={cn(i === keyIndex && "font-bold text-foreground")}>
            {seg}
          </span>
        </span>
      ))}
    </span>
  );
}

function RowSummary({ row }: { row: ChartStringRowView }) {
  const sub =
    row.subactivity && GL_SUBACTIVITIES[row.subactivity]
      ? `${row.subactivity} ${GL_SUBACTIVITIES[row.subactivity]}`
      : row.subactivity;
  const bits = [
    row.type,
    KIND_LABEL[row.kind],
    row.awardCode,
    row.fpNumber,
    sub,
  ].filter(Boolean);
  return (
    <span className="text-xs text-os-grey">
      {bits.join(" · ")}
      {row.createdBy ? ` — ${row.createdBy}` : ""}
    </span>
  );
}

export function ChartStringPanel({
  chartStrings,
  termOptions,
  currentTermId,
}: {
  chartStrings: ChartStringRowView[];
  termOptions: { id: string; code: string }[];
  currentTermId: string | null;
}) {
  const fetcher = useFetcher<{
    error?: string;
    ok?: boolean;
    chartStringWarnings?: string[];
  }>();
  const [adding, setAdding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const busy = fetcher.state !== "idle";
  const error = fetcher.data?.error;
  const warnings = fetcher.data?.chartStringWarnings ?? [];

  const current = chartStrings.filter((r) => r.isCurrent);
  const superseded = chartStrings.filter((r) => !r.isCurrent);

  // Close the add form once a save lands, but keep any warnings visible.
  if (adding && fetcher.state === "idle" && fetcher.data?.ok) {
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {current.length === 0 && (
        <p className="text-sm text-os-grey">
          No chart string recorded. Projects without one inherit the lab
          default for the term.
        </p>
      )}

      {current.map((row) => (
        <div
          key={row.id}
          className="flex flex-col gap-1 border-b border-os-container pb-3 last:border-0"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground">
              {row.termCode}
            </span>
            <ChartString value={row.normalized} type={row.type} />
          </div>
          <RowSummary row={row} />
          {row.note && <span className="text-xs text-os-grey">{row.note}</span>}
        </div>
      ))}

      {superseded.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-os-grey hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" />
            {showHistory ? "Hide" : "Show"} {superseded.length} superseded
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col gap-2 border-l border-os-container pl-3">
              {superseded.map((row) => (
                <div key={row.id} className="flex flex-col gap-0.5 opacity-60">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs">{row.termCode}</span>
                    <ChartString value={row.normalized} type={row.type} />
                  </div>
                  <RowSummary row={row} />
                  {row.supersedeReason && (
                    <span className="text-xs italic text-os-grey">
                      {row.supersedeReason}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-red-500">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 self-start text-xs text-os-grey hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          Add a chart string
        </button>
      ) : (
        <fetcher.Form method="post" className="flex flex-col gap-2">
          <input type="hidden" name="intent" value="chart-string" />

          <label className="flex flex-col gap-1">
            <span className="text-xs text-os-grey">Term</span>
            <select
              name="termId"
              defaultValue={currentTermId ?? termOptions[0]?.id}
              className={field}
              required
            >
              {termOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-os-grey">Chart string</span>
            <input
              name="chartString"
              className={cn(field, "font-mono")}
              placeholder="523241.5000.B04662.XXXXX.330"
              required
            />
            <span className="text-xs text-os-grey">
              GL is entity.org.funding.activity.subactivity. PTAEO is
              project.task.award.expenditure-type.org — XXXXX in the
              expenditure type is expected.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-os-grey">Kind</span>
            <select name="kind" defaultValue="FUNDED" className={field}>
              <option value="FUNDED">Funded award</option>
              <option value="ADVANCE">Advance account</option>
              <option value="DEPARTMENT">Departmental GL</option>
            </select>
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <input name="fpNumber" className={field} placeholder="FP number" />
            <input name="awardId" className={field} placeholder="Award (AWD…)" />
          </div>
          <input
            name="rapportName"
            className={field}
            placeholder="RAPPORT title, if it differs from the project name"
          />
          {current.length > 0 && (
            <input
              name="supersedeReason"
              className={field}
              placeholder="Why this replaces the current one"
            />
          )}
          <input name="note" className={field} placeholder="Note (optional)" />

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-os-input bg-os-accent px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-os-input border border-os-container px-3 py-2 text-sm text-os-grey"
            >
              Cancel
            </button>
          </div>
        </fetcher.Form>
      )}
    </div>
  );
}

export const CHART_STRING_PANEL_ICON = Info;
