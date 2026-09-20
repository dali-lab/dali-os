import { useState } from "react";
import { useRevalidator } from "react-router";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { Select, type SelectOption } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { Pill, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import type { TimelineEntry } from "~/hiring/lib/application-timeline";

// The applicant's stage changes as one list: application, delibs, interviews
// and decisions in the order they happened. Replaces the old split between a
// Decisions list and a Delibs list on the two applicant detail pages.
export function ApplicationTimeline({ entries }: { entries: TimelineEntry[] }) {
  const { bodyText } = useOsChrome();
  if (entries.length === 0) {
    return <p className={cn(bodyText, "py-3 text-center")}>Nothing has happened yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {entries.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-well px-4 py-3"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">{e.label}</span>
            {(e.detail || e.by) && (
              <span className="text-sm text-os-grey">
                {[e.detail, e.by ? `by ${e.by}` : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Pill dot={e.tone}>{e.badge}</Pill>
            <span className="text-sm text-os-grey tabular-nums">
              {new Date(e.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

const STAGE_OPTIONS: SelectOption[] = [
  { value: "InvitedToInterview", label: "Invited to interview" },
  { value: "Accepted", label: "Accepted" },
  { value: "Waitlisted", label: "Waitlisted" },
  { value: "Rejected", label: "Rejected" },
];

const STAGE_LABEL = (value: string) =>
  STAGE_OPTIONS.find((o) => o.value === value)?.label ?? value;

/**
 * Leads only: move an applicant to a stage without running a delib. Writes the
 * same Draft decision a closed board would, so the hiring lead still finalizes
 * and releases it. Nothing is emailed.
 */
export function StageMoveControl({ domainApplicationId }: { domainApplicationId: string }) {
  const { formTrigger } = useOsChrome();
  const dialog = useDialog();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [type, setType] = useState("");
  const [busy, setBusy] = useState(false);

  async function move() {
    if (!type) return;
    const label = STAGE_LABEL(type);
    if (
      !(await dialog.confirm({
        title: `Move this applicant to ${label.toLowerCase()}?`,
        description:
          "This records a draft decision without a delib. The hiring lead still finalizes and releases it, so nothing is emailed yet.",
        confirmLabel: "Move",
      }))
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/domain-applications/${domainApplicationId}/decisions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, stage: "Draft", notes: "Moved without delibs." }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't move this applicant.");
        return;
      }
      setType("");
      revalidator.revalidate();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-56">
        <Select
          ariaLabel="Move to stage"
          value={type}
          placeholder="Move to stage"
          onChange={setType}
          options={STAGE_OPTIONS}
          buttonClassName={rowTrigger(formTrigger)}
        />
      </div>
      <button
        type="button"
        onClick={move}
        disabled={!type || busy}
        className={buttonClasses("secondary", "md")}
      >
        {busy ? "Moving…" : "Move"}
      </button>
    </div>
  );
}
