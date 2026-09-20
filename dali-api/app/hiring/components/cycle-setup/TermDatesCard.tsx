import { useState } from "react";
import { useFetcher } from "react-router";
import { Select } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import { buttonClasses } from "~/components/ui/Button";
import { useOsChrome } from "~/components/os-chrome";
import { termFilterOrder, type TermOption } from "~/lib/terms.shared";
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
}: {
  termId: string | null;
  termOptions: TermOption[];
  openDate: string | null;
  /** The intended close (the pre-extension date when an extension is active). */
  closeDate: string | null;
  cycleStatus: string;
}) {
  const { panel, panelPad, sectionTitle, bodyText, fieldLabel, formTrigger } = useOsChrome();
  const fetcher = useFetcher();
  const [term, setTerm] = useState(termId ?? "");
  const [open, setOpen] = useState(toYmd(openDate));
  const [close, setClose] = useState(toYmd(closeDate));
  // The open date is fixed once applications have opened.
  const openLocked = cycleStatus !== "Draft";
  // One row height for the term dropdown, the date fields (h-9) and Save.
  const termTrigger = rowTrigger(formTrigger);

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
    </fetcher.Form>
  );
}
