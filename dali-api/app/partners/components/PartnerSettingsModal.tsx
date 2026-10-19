// Partners settings, opened from the gear on the Applications board. Reads and
// writes through the /core/partners/settings route with fetchers so the board
// stays put underneath; the board revalidates on its own after each save.

import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { MultiSelect, Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { loader } from "../routes/core.partners.settings";

const SETTINGS_PATH = "/core/partners/settings";

type SettingsData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type ActionResult = { ok?: boolean; error?: string };

export function PartnerSettingsModal({ onClose }: { onClose: () => void }) {
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
          <FollowUpSection key={JSON.stringify(d.settings)} data={d} onSaved={reload} />
          <section className="flex flex-col gap-5 py-6 last:pb-0">
            <h3 className="font-heading text-[15px] font-semibold text-foreground">Partner forms</h3>
            <FormBindingRow
              title="Application form"
              description="Extra questions partners answer when they pitch a project."
              binding={d.applicationFormBinding}
              forms={d.selectableForms}
              bindIntent="bind-form"
              clearIntent="clear-form"
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
              removeDescription="Partners whose project ends will get no survey until another is chosen. Submitted responses are kept."
              unpublishedNote="Partners won't see a survey until it is."
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

/** Calls onSaved once a fetcher's submission comes back without an error. */
function useOnSaved(fetcher: { state: string; data?: ActionResult }, onSaved: () => void) {
  const [wasBusy, setWasBusy] = useState(false);
  useEffect(() => {
    if (fetcher.state !== "idle") setWasBusy(true);
    else if (wasBusy) {
      setWasBusy(false);
      if (!fetcher.data?.error) onSaved();
    }
  }, [fetcher.state, fetcher.data, wasBusy, onSaved]);
}

function FollowUpSection({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const save = useFetcher<ActionResult>();
  const [panelIds, setPanelIds] = useState<string[]>(data.settings.interviewPanelUserIds);
  useOnSaved(save, onSaved);

  return (
    <save.Form method="post" action={SETTINGS_PATH} className="flex flex-col gap-4 pb-6">
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

function FormBindingRow({
  title,
  description,
  binding,
  forms,
  bindIntent,
  clearIntent,
  removeDescription,
  unpublishedNote,
  onSaved,
}: {
  title: string;
  description: string;
  binding: SettingsData["applicationFormBinding"];
  forms: SettingsData["selectableForms"];
  bindIntent: string;
  clearIntent: string;
  removeDescription: string;
  unpublishedNote: string;
  onSaved: () => void;
}) {
  const confirmSubmit = useConfirmSubmit();
  const bind = useFetcher<ActionResult>();
  const clear = useFetcher<ActionResult>();
  useOnSaved(bind, onSaved);
  useOnSaved(clear, onSaved);
  const error = bind.data?.error ?? clear.data?.error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-sm text-os-grey">{description}</p>
        </div>
        {binding && (
          <Link to={`/forms/edit/${binding.formId}`} className="shrink-0 text-sm text-os-accent hover:underline">
            Edit form
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <bind.Form method="post" action={SETTINGS_PATH} className="flex min-w-0 flex-1 items-center gap-2">
          <input type="hidden" name="intent" value={bindIntent} />
          <div className="min-w-0 flex-1">
            <Select
              name="formId"
              defaultValue={binding?.formId ?? ""}
              placeholder="Choose a form"
              ariaLabel={title}
              options={forms.map((f) => ({
                value: f.id,
                label: `${f.name}${f.published ? "" : " (unpublished)"}`,
              }))}
              buttonClassName="w-full"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={bind.state !== "idle"}>
            {binding ? "Change" : "Use form"}
          </Button>
        </bind.Form>
        {binding && (
          <clear.Form
            method="post"
            action={SETTINGS_PATH}
            onSubmit={confirmSubmit({
              title: `Remove the ${title.toLowerCase()}?`,
              description: removeDescription,
              confirmLabel: "Remove",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="intent" value={clearIntent} />
            <Button type="submit" variant="secondary" size="sm" disabled={clear.state !== "idle"}>
              Remove
            </Button>
          </clear.Form>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {binding && (!binding.published || !binding.hasVersion) && (
        <p className="text-sm text-os-amber">
          {binding.hasVersion ? "This form isn't published yet." : "This form has no saved version yet."} {unpublishedNote}
        </p>
      )}
    </div>
  );
}
