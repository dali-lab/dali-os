import { useState } from "react";
import { useFetcher } from "react-router";
import { InfoTip, MultiSelect, Select } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import { termFilterOrder, type TermOption } from "~/lib/terms.shared";
import {
  eligibleStartTerms,
  pruneStartTermIds,
  type StartTermOption,
} from "~/hiring/lib/start-terms";
import { APPLICATION_TZ, getZonedYMD } from "~/lib/timezone";
import { cn } from "~/lib/cn";
import { rowTrigger } from "./SetupCard";

function toYmd(iso: string | null): string {
  if (!iso) return "";
  const { year, month, day } = getZonedYMD(new Date(iso), APPLICATION_TZ);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The term dates every phase (Week N starts N-1 weeks after term start); the
// application window (open and close dates) sits beside it. Extending the
// close keeps its own card, since it only matters once a close date is set.
export function TermDatesCard({
  termId,
  termOptions,
  openDate,
  closeDate,
  cycleStatus,
  startTermIds,
  startTermCandidates,
  showStartTerms = false,
}: {
  termId: string | null;
  termOptions: TermOption[];
  openDate: string | null;
  /** The intended close (the pre-extension date when an extension is active). */
  closeDate: string | null;
  cycleStatus: string;
  /** The start terms this cycle offers applicants. */
  startTermIds: string[];
  /** Every term, with sortKey, so the eligible set is computed here. */
  startTermCandidates: StartTermOption[];
  /** Students cycles only: Fellowship/Core hires are already members. */
  showStartTerms?: boolean;
}) {
  const { panel, panelPad, sectionTitle, bodyText, fieldLabel, formTrigger } = useOsChrome();
  const fetcher = useFetcher();
  const [term, setTerm] = useState(termId ?? "");
  const [open, setOpen] = useState(toYmd(openDate));
  const [close, setClose] = useState(toYmd(closeDate));
  const [startTerms, setStartTerms] = useState<string[]>(startTermIds);
  // The open date is fixed once applications have opened.
  const openLocked = cycleStatus !== "Draft";
  // One row height for the term dropdown, the date fields (h-9) and Save.
  const termTrigger = rowTrigger(formTrigger);

  // Eligibility follows the term picked ABOVE, not the saved one, so moving the
  // cycle's term immediately narrows what can be offered. The server re-floors
  // on save regardless (setCycleStartTerms) — this is so the lead sees it.
  const floorSortKey =
    startTermCandidates.find((t) => t.id === term)?.sortKey ?? null;
  const eligible = eligibleStartTerms(startTermCandidates, floorSortKey);
  // Picks the term change just invalidated drop out of the control rather than
  // sitting there looking saved and disappearing on Save.
  const chosenStartTerms = pruneStartTermIds(
    startTerms,
    startTermCandidates,
    floorSortKey,
  );

  return (
    <fetcher.Form method="post" className={cn(panel, panelPad, "flex flex-col gap-4")}>
      <input type="hidden" name="intent" value="save-term-dates" />
      <div className="flex flex-col gap-1">
        <h3 className={sectionTitle}>Term and dates</h3>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div className={cn(fieldLabel, "w-56")}>
          Term
          <Select
            name="termId"
            ariaLabel="Term"
            value={term}
            placeholder="Pick a term"
            onChange={setTerm}
            options={termFilterOrder(termOptions, { includeAll: false })}
            buttonClassName={termTrigger}
          />
        </div>
        <div className={fieldLabel}>
          Applications open
          <DateField
            mode="date"
            name="openDate"
            value={open}
            onChange={setOpen}
            disabled={openLocked}
            ariaLabel="Applications open"
            className="w-44"
            buttonClassName={termTrigger}
          />
        </div>
        <div className={fieldLabel}>
          Applications close
          <DateField
            mode="date"
            name="closeDate"
            value={close}
            onChange={setClose}
            ariaLabel="Applications close"
            className="w-44"
            buttonClassName={termTrigger}
          />
        </div>
        <button type="submit" disabled={fetcher.state !== "idle"} className={buttonClasses("primary", "md", "h-9")}>
          {fetcher.state !== "idle" ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="text-xs text-os-grey">Applications stop at 11:59 PM Eastern on the close date.</p>

      {showStartTerms && (
        <div className="flex flex-col gap-2 border-t border-os-container pt-4">
          <input
            type="hidden"
            name="startTermIds"
            value={JSON.stringify(chosenStartTerms)}
          />
          <div className={cn(fieldLabel, "w-72")}>
            <span className="flex items-center gap-1.5">
              Start terms
              <InfoTip content="The terms an applicant can choose to begin in. A start term can't be earlier than the term above, since that's when the hiring runs." />
            </span>
            <MultiSelect
              values={chosenStartTerms}
              options={eligible.map((t) => ({ value: t.id, label: t.code }))}
              onChange={setStartTerms}
              ariaLabel="Start terms this cycle offers"
              placeholder="Same term as the cycle"
              emptyLabel={term ? "No terms on or after this one" : "Pick a term first"}
              buttonClassName={termTrigger}
            />
          </div>
          <p className="text-xs text-os-grey">
            {chosenStartTerms.length === 0
              ? "Applicants aren't asked. Hires start in the cycle's own term."
              : chosenStartTerms.length === 1
                ? "One term, so applicants aren't asked. Everyone hired starts in it."
                : "Applicants pick one of these on the application. Core can change it later from Onboarding."}
          </p>
        </div>
      )}
    </fetcher.Form>
  );
}
