import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { ExternalLink, MoreHorizontal, Send } from "lucide-react";
import { Menu } from "~/components/ui/floating";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { GATE_OPTIONS } from "./SlotGateControl";

type SelectableForm = { id: string; name: string; published: boolean; boundToCycleName?: string };

type Binding = {
  formId: string;
  formName: string;
  published: boolean;
  gateAudience: string | null;
} | null;

function useBoardAction() {
  const fetcher = useFetcher<{ ok?: boolean; error?: string; movedFrom?: string | null }>();
  const toast = useToast();
  const data = fetcher.state === "idle" ? fetcher.data : undefined;
  useEffect(() => {
    if (data?.error) toast.error(data.error);
    else if (data?.movedFrom) toast(`Moved off ${data.movedFrom}.`);
  }, [data, toast]);
  return {
    submit: (fields: Record<string, string>) => fetcher.submit(fields, { method: "post" }),
    pending: fetcher.formData,
  };
}

// The line under a board's title: which form it collects with, whether it's
// open and whether it locks the app. Managers change all three from the ⋯
// menu beside it.
export function BoardSettings({
  slotLabel,
  binding,
  forms,
  canManage,
}: {
  slotLabel: string;
  binding: Binding;
  forms: SelectableForm[];
  canManage: boolean;
}) {
  const { confirm } = useDialog();
  const action = useBoardAction();
  const pendingPublished = action.pending?.get("published");
  const published = pendingPublished != null ? pendingPublished === "1" : !!binding?.published;
  const pendingGate = action.pending?.get("gateAudience");
  const gate = pendingGate != null ? String(pendingGate) : (binding?.gateAudience ?? "");

  async function pickForm(form: SelectableForm) {
    if (form.boundToCycleName) {
      const ok = await confirm({
        title: `Move this form off ${form.boundToCycleName}?`,
        description: `"${form.name}" is collecting for ${form.boundToCycleName}. Moving it here stops that, and brings its columns and app lock along. Submissions already recorded for ${form.boundToCycleName} stay with it.`,
        confirmLabel: "Move it here",
        tone: "destructive",
      });
      if (!ok) return;
    }
    action.submit({
      intent: "set-slot-form",
      formId: form.id,
      ...(form.boundToCycleName ? { allowMove: "1" } : {}),
    });
  }

  const gateLabel = GATE_OPTIONS.find((o) => o.value === gate)?.label;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      {binding ? (
        <>
          <span>
            Collecting with{" "}
            <Link to={`/forms/edit/${binding.formId}`} className="text-foreground hover:underline">
              {binding.formName}
            </Link>
          </span>
          <span aria-hidden>·</span>
          <span>{published ? "Open" : "Closed"}</span>
          {gate && (
            <>
              <span aria-hidden>·</span>
              <span>Locks the app for {gateLabel?.toLowerCase()}</span>
            </>
          )}
        </>
      ) : (
        <span>No {slotLabel} form is connected for this term.</span>
      )}
      {canManage && (
        <Menu
          ariaLabel={`${slotLabel} settings`}
          trigger={<IconButton label={`${slotLabel} settings`} icon={MoreHorizontal} />}
        >
          <Menu.Sub label={binding ? "Change form" : "Connect a form"}>
            {forms.map((f) => (
              <Menu.Item key={f.id} checked={f.id === binding?.formId} onSelect={() => void pickForm(f)}>
                {f.name + (f.published ? "" : " (closed)") + (f.boundToCycleName ? ` · on ${f.boundToCycleName}` : "")}
              </Menu.Item>
            ))}
          </Menu.Sub>
          {binding && (
            <>
              <Menu.Item
                checked={published}
                onSelect={() => action.submit({ intent: "set-slot-published", published: published ? "0" : "1" })}
              >
                Open for submissions
              </Menu.Item>
              <Menu.Sub label="Lock the app">
                {GATE_OPTIONS.map((o) => (
                  <Menu.Item
                    key={o.value}
                    checked={o.value === gate}
                    onSelect={() => action.submit({ intent: "set-slot-gate", gateAudience: o.value })}
                  >
                    {o.label}
                  </Menu.Item>
                ))}
              </Menu.Sub>
              <Menu.Separator />
              {published && (
                <Menu.LinkItem
                  to={`/core/communications/announcements?formId=${encodeURIComponent(binding.formId)}&audience=all`}
                  icon={<Send className="h-3.5 w-3.5" />}
                >
                  Send to members
                </Menu.LinkItem>
              )}
              <Menu.LinkItem to={`/forms/edit/${binding.formId}`} icon={<ExternalLink className="h-3.5 w-3.5" />}>
                Open the form
              </Menu.LinkItem>
            </>
          )}
        </Menu>
      )}
    </div>
  );
}
