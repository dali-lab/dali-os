// Partners settings, opened from the gear on the Applications board. Reads and
// writes through the /core/partners/settings route with fetchers so the board
// stays put underneath; the board revalidates on its own after each save.

import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { MultiSelect, Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { Toggle } from "~/components/ui/Toggle";
import { modalCardClass } from "~/components/os-chrome";
import { FormBindingRow, useOnSaved } from "~/forms/components/FormBindingRow";
import { cn } from "~/lib/cn";
import {
  CARD_SORTS,
  CARD_SORT_LABELS,
  type PartnerBoardPrefs,
  type PartnerCardSort,
} from "../lib/partner-board";
import type { loader } from "../routes/core.partners.settings";
import {
  centsToDollars,
  MAINTENANCE_PLANS,
  maintenanceLabel,
  type MaintenancePrices,
} from "../lib/partner-renewals";

const SETTINGS_PATH = "/core/partners/settings";

type SettingsData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type ActionResult = { ok?: boolean; error?: string };

type BoardDisplay = {
  prefs: PartnerBoardPrefs;
  onChange: (next: PartnerBoardPrefs) => void;
};

export function PartnerSettingsModal({
  onClose,
  board,
}: {
  onClose: () => void;
  /** Applications-board display preferences; only the board page passes them. */
  board?: BoardDisplay;
}) {
  const data = useFetcher<SettingsData>();
  const reload = () => data.load(SETTINGS_PATH);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const d = data.data;

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="partner-settings-title"
      containerClassName={cn(modalCardClass("max-w-2xl"), "os-form flex flex-col gap-6 p-6")}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="partner-settings-title" className="os-modal-title">
          Partner settings
        </h2>
        <button type="button" onClick={onClose} className="os-icon-btn" aria-label="Close">
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {!d ? (
        <p className="text-sm text-os-grey">Loading…</p>
      ) : (
        <div className="flex flex-col divide-y divide-os-container">
          {board && <BoardDisplaySection board={board} />}
          <FollowUpSection key={JSON.stringify(d.settings)} data={d} onSaved={reload} />
          <MaintenancePricesSection
            key={`maintenance:${JSON.stringify(d.settings.maintenancePrices)}`}
            prices={d.settings.maintenancePrices}
            onSaved={reload}
          />
          <section className="flex flex-col gap-5 py-6 last:pb-0">
            <h3 className="font-heading text-[15px] font-semibold text-foreground">Partner forms</h3>
            <FormBindingRow
              title="Application form"
              description="Extra questions partners answer when they pitch a project."
              binding={d.applicationFormBinding}
              forms={d.selectableForms}
              bindIntent="bind-form"
              clearIntent="clear-form"
              action={SETTINGS_PATH}
              publishSlot="application"
              openNote="Partners can fill this form now."
              removeDescription="New applicants will have no form to fill in until another is chosen. Submitted responses are kept."
              unpublishedNote="Partners only see the built-in pitch fields."
              onSaved={reload}
            />
            <FormBindingRow
              title="Post-project survey"
              description="What a partner fills out once their project ends."
              binding={d.surveyFormBinding}
              forms={d.selectableForms}
              bindIntent="bind-survey-form"
              clearIntent="clear-survey-form"
              action={SETTINGS_PATH}
              publishSlot="survey"
              openNote="Partners can fill this form now."
              removeDescription="Partners whose project ends will get no survey until another is chosen. Submitted responses are kept."
              unpublishedNote="Partners won't get a survey until it's open."
              onSaved={reload}
            />
            <p className="text-sm text-os-grey">
              Partner emails are edited in{" "}
              <Link to="/core/communications/email" className="text-os-accent hover:underline">
                Communications
              </Link>
              .
            </p>
          </section>
        </div>
      )}
    </Modal>
  );
}

function BoardDisplaySection({ board }: { board: BoardDisplay }) {
  const { prefs, onChange } = board;
  return (
    <section className="flex flex-col gap-4 pb-6">
      <h3 className="font-heading text-[15px] font-semibold text-foreground">Applications board</h3>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-os-grey">Order cards within a column</span>
        <Select
          value={prefs.sort}
          onChange={(value) => onChange({ ...prefs, sort: value as PartnerCardSort })}
          ariaLabel="Order cards within a column"
          options={CARD_SORTS.map((s) => ({ value: s, label: CARD_SORT_LABELS[s] }))}
          buttonClassName="w-full sm:w-64"
        />
      </div>
      <Toggle
        tone="os"
        checked={prefs.showPaused}
        onChange={(e) => onChange({ ...prefs, showPaused: e.currentTarget.checked })}
        label="Show paused"
        description="Keep applications on hold visible on the board."
      />
      <Toggle
        tone="os"
        checked={prefs.showRejectedPastTerms}
        onChange={(e) => onChange({ ...prefs, showRejectedPastTerms: e.currentTarget.checked })}
        label="Show rejected from past terms"
        description="Include rejections older than the current term."
      />
    </section>
  );
}

/** Calls onSaved once a fetcher's submission comes back without an error. */

function FollowUpSection({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const save = useFetcher<ActionResult>();
  const [panelIds, setPanelIds] = useState<string[]>(data.settings.interviewPanelUserIds);
  useOnSaved(save, onSaved);

  return (
    <save.Form method="post" action={SETTINGS_PATH} className="flex flex-col gap-4 py-6 first:pt-0">
      <h3 className="font-heading text-[15px] font-semibold text-foreground">Interviews and follow-up</h3>
      <input type="hidden" name="intent" value="settings-save" />
      {panelIds.map((id) => (
        <input key={id} type="hidden" name="interviewPanelUserIds" value={id} />
      ))}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-os-grey">Interview panel</span>
        <MultiSelect
          values={panelIds}
          onChange={setPanelIds}
          options={data.coreMembers.map((m) => ({ value: m.userId, label: m.name }))}
          placeholder="All of Core"
          ariaLabel="Interview panel"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-os-grey">Mark an application stale after</span>
        <span className="flex items-center gap-2 text-sm text-foreground">
          <input
            name="staleDays"
            type="number"
            min={1}
            defaultValue={data.settings.staleDays}
            aria-label="Days without activity"
            className="w-24"
          />
          days without activity
        </span>
      </div>
      {save.data?.error && <p className="text-sm text-destructive">{save.data.error}</p>}
      <Button type="submit" variant="primary" size="sm" disabled={save.state !== "idle"} className="self-end">
        {save.state !== "idle" ? "Saving…" : "Save"}
      </Button>
    </save.Form>
  );
}

function MaintenancePricesSection({
  prices,
  onSaved,
}: {
  prices: MaintenancePrices;
  onSaved: () => void;
}) {
  const save = useFetcher<ActionResult>();
  useOnSaved(save, onSaved);
  return (
    <save.Form method="post" action={SETTINGS_PATH} className="flex flex-col gap-4 py-6">
      <div>
        <h3 className="font-heading text-[15px] font-semibold text-foreground">Maintenance prices</h3>
        <p className="text-sm text-os-grey">
          Price per term for each maintenance plan. Choosing a plan on Renewals fills in this price, and you can change
          it per project.
        </p>
      </div>
      <input type="hidden" name="intent" value="maintenance-prices" />
      <div className="grid gap-3 sm:grid-cols-3">
        {MAINTENANCE_PLANS.map((plan) => (
          <label key={plan} className="flex flex-col gap-1.5">
            <span className="text-sm text-os-grey">{maintenanceLabel(plan)}</span>
            <input
              name={plan}
              inputMode="decimal"
              placeholder="Dollars"
              defaultValue={centsToDollars(prices[plan])}
              aria-label={`${maintenanceLabel(plan)} price`}
            />
          </label>
        ))}
      </div>
      {save.data?.error && <p className="text-sm text-destructive">{save.data.error}</p>}
      <Button type="submit" variant="primary" size="sm" disabled={save.state !== "idle"} className="self-end">
        {save.state !== "idle" ? "Saving…" : "Save prices"}
      </Button>
    </save.Form>
  );
}

