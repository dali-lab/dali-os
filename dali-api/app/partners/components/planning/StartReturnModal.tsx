import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { Combobox, MultiSelect } from "~/components/ui/floating";
import type { ReturnableProject } from "../../lib/partner-returns.server";
import { fetcherError, PLANNING_ACTION } from "./SavedTextField";

export function StartReturnModal({
  projects,
  terms,
  defaultTermId,
  onCreated,
  onClose,
}: {
  projects: ReturnableProject[];
  terms: { id: string; code: string }[];
  defaultTermId: string;
  onCreated: (applicationId: string) => void;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ ok?: boolean; applicationId?: string; error?: string }>();
  const [projectId, setProjectId] = useState("");
  const [termIds, setTermIds] = useState<string[]>([defaultTermId]);
  const busy = fetcher.state !== "idle";
  const error = fetcherError(fetcher.data);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.applicationId) onCreated(fetcher.data.applicationId);
  }, [fetcher.state, fetcher.data, onCreated]);

  const submit = () => {
    const form = new FormData();
    form.set("intent", "start-return");
    form.set("projectId", projectId);
    for (const id of termIds) form.append("targetTermId", id);
    fetcher.submit(form, { method: "post", action: PLANNING_ACTION });
  };

  return (
    <Modal open onClose={onClose} labelledBy="start-return-title">
      <ModalHeader titleId="start-return-title" title="Start a return" onClose={onClose} closeLabel="Close" />
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          For a past project that may come back. This adds an application to the partner board with the same partner
          and last term&apos;s spots. Accepting it reopens the same project.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Past project</span>
          <Combobox
            ariaLabel="Past project"
            placeholder="Search past projects"
            value={projectId}
            onChange={setProjectId}
            emptyLabel="No past projects"
            options={projects.map((p) => ({
              value: p.id,
              label: p.lastTermCode ? `${p.name} (last ran ${p.lastTermCode})` : p.name,
            }))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Terms it would run</span>
          <MultiSelect
            ariaLabel="Terms it would run"
            placeholder="Pick terms"
            values={termIds}
            onChange={setTermIds}
            options={terms.map((t) => ({ value: t.id, label: t.code }))}
          />
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy || !projectId || termIds.length === 0}>
            {busy ? "Starting" : "Start return"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
