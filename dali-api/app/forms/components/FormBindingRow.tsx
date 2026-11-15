import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { Toggle } from "~/components/ui/Toggle";
import { useConfirmSubmit } from "~/components/ui/dialog";

type ActionResult = { ok?: boolean; error?: string };

export type BoundForm = { formId: string; published: boolean; hasVersion: boolean };
export type BindableForm = { id: string; name: string; published: boolean };

export function useOnSaved(fetcher: { state: string; data?: ActionResult }, onSaved?: () => void) {
  const [wasBusy, setWasBusy] = useState(false);
  useEffect(() => {
    if (fetcher.state !== "idle") setWasBusy(true);
    else if (wasBusy) {
      setWasBusy(false);
      if (!fetcher.data?.error) onSaved?.();
    }
  }, [fetcher.state, fetcher.data, wasBusy, onSaved]);
}

export function FormBindingRow({
  title,
  description,
  binding,
  forms,
  action,
  bindIntent,
  clearIntent,
  publishSlot,
  removeDescription,
  openNote,
  unpublishedNote,
  onSaved,
}: {
  title: string;
  description: string;
  binding: BoundForm | null;
  forms: BindableForm[];
  action: string;
  bindIntent: string;
  clearIntent: string;
  publishSlot: string;
  removeDescription: string;
  openNote: string;
  unpublishedNote: string;
  onSaved?: () => void;
}) {
  const confirmSubmit = useConfirmSubmit();
  const bind = useFetcher<ActionResult>();
  const clear = useFetcher<ActionResult>();
  const publish = useFetcher<ActionResult>();
  useOnSaved(bind, onSaved);
  useOnSaved(clear, onSaved);
  useOnSaved(publish, onSaved);
  const error = bind.data?.error ?? clear.data?.error ?? publish.data?.error;
  const pendingPublished = publish.formData?.get("published");
  const published =
    pendingPublished != null ? pendingPublished === "1" : !!binding?.published;

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
        <bind.Form method="post" action={action} className="flex min-w-0 flex-1 items-center gap-2">
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
            action={action}
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
      {binding?.hasVersion && (
        <Toggle
          tone="os"
          checked={published}
          disabled={publish.state !== "idle"}
          onChange={(e) =>
            publish.submit(
              { intent: "set-form-published", slot: publishSlot, published: e.currentTarget.checked ? "1" : "0" },
              { method: "post", action },
            )
          }
          label="Open for responses"
          description={published ? openNote : `Closed. ${unpublishedNote}`}
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {binding && !binding.hasVersion && (
        <p className="text-sm text-os-amber">
          This form has no saved version yet. {unpublishedNote}
        </p>
      )}
    </div>
  );
}
