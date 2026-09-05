// The project hub's Infrastructure section. Read-only Fly + Neon inventory/usage
// for anyone who can view the project; config editing + change-requests for
// staffed members (core||isProjectMember, passed as canEdit). No infra actions
// here — those live in the Core/Admin fleet console; staffed members ask via a
// request that Core fulfills.

import { useEffect, useState, type FormEvent } from "react";
import { useFetcher } from "react-router";
import { Server } from "lucide-react";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";
import type { ProjectInfraRequest } from "~/lib/infra/requests.server";
import { ProjectInfraView } from "~/components/infra/ProjectInfraView";
import { buttonClasses } from "~/components/ui/Button";
import { timeAgo } from "~/components/infra/format";

type Config = {
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  infraEnabled: boolean;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
};

const KINDS: { value: string; label: string }[] = [
  { value: "provision_database", label: "Provision a database" },
  { value: "scale_compute", label: "Scale compute" },
  { value: "adjust_limits", label: "Adjust limits" },
  { value: "other", label: "Something else" },
];

export function ProjectInfraSection({
  projectId,
  canEdit,
  config,
  view,
  requests,
}: {
  projectId: string;
  canEdit: boolean;
  config: Config;
  view: ProjectFleet | null;
  requests: ProjectInfraRequest[];
}) {
  const configured = Boolean(config.flyOrgSlug || config.neonOrgId);
  const [showConfig, setShowConfig] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Server className="h-4 w-4 text-muted-foreground" />
          Infrastructure
        </h2>
        {canEdit && (
          <div className="flex gap-2">
            {configured && (
              <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setShowRequest((v) => !v)}>
                Request a change
              </button>
            )}
            <button type="button" className={buttonClasses("ghost", "sm")} onClick={() => setShowConfig((v) => !v)}>
              {showConfig ? "Close config" : configured ? "Edit config" : "Configure"}
            </button>
          </div>
        )}
      </div>

      {canEdit && showConfig && <ConfigEditor config={config} onDone={() => setShowConfig(false)} />}
      {canEdit && showRequest && configured && (
        <RequestForm projectId={projectId} onDone={() => setShowRequest(false)} />
      )}

      {view ? (
        <ProjectInfraView project={view} />
      ) : configured ? (
        <p className="text-sm text-muted-foreground">
          Configured, but not swept yet — check back after the next infrastructure sweep.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No cloud infrastructure linked to this project yet.
          {canEdit ? " Use Configure to add its Fly.io / Neon details." : ""}
        </p>
      )}

      {canEdit && requests.length > 0 && <RequestHistory requests={requests} />}
    </div>
  );
}

function ConfigEditor({ config, onDone }: { config: Config; onDone: () => void }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  return (
    <fetcher.Form method="post" className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-xs">
      <input type="hidden" name="intent" value="infra-config" />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Fly org slug</span>
          <input name="flyOrgSlug" defaultValue={config.flyOrgSlug ?? ""} placeholder="acme-org" className="w-44 rounded border border-border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Neon org id</span>
          <input name="neonOrgId" defaultValue={config.neonOrgId ?? ""} placeholder="org-acme-1234" className="w-44 rounded border border-border px-2 py-1" />
        </label>
        <label className="flex items-center gap-1.5 self-end text-muted-foreground">
          <input type="checkbox" name="infraEnabled" defaultChecked={config.infraEnabled} />
          Sweep enabled
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Fly read token (write-only)</span>
          <input name="flyReadToken" type="password" placeholder={config.hasFlyReadToken ? "•••• set — blank keeps" : "FlyV1 …"} className="w-56 rounded border border-border px-2 py-1" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Fly write token (write-only)</span>
          <input name="flyWriteToken" type="password" placeholder={config.hasFlyWriteToken ? "•••• set — blank keeps" : "FlyV1 …"} className="w-56 rounded border border-border px-2 py-1" />
        </label>
      </div>
      {fetcher.data?.error && <p className="text-destructive">{fetcher.data.error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={fetcher.state !== "idle"} className={buttonClasses("primary", "sm")}>
          {fetcher.state !== "idle" ? "Saving…" : "Save config"}
        </button>
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={onDone}>Cancel</button>
        <span className="text-muted-foreground">Tokens are encrypted at rest; the Neon key is shared across projects.</span>
      </div>
    </fetcher.Form>
  );
}

function RequestForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fetcher.submit(
      {
        intent: "submit",
        projectId,
        kind: String(fd.get("kind") ?? "other"),
        details: String(fd.get("details") ?? ""),
        targetHint: String(fd.get("targetHint") ?? ""),
      },
      { method: "post", action: "/api/infra/request", encType: "application/json" },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Request</span>
          <select name="kind" className="w-52 rounded border border-border px-2 py-1">
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-muted-foreground">Which resource? (optional)</span>
          <input name="targetHint" placeholder="e.g. the worker app" className="w-52 rounded border border-border px-2 py-1" />
        </label>
      </div>
      <label className="flex flex-col gap-0.5">
        <span className="text-muted-foreground">Details</span>
        <textarea name="details" required rows={2} placeholder="What do you need, and why?" className="w-full rounded border border-border px-2 py-1" />
      </label>
      {fetcher.data?.error && <p className="text-destructive">{fetcher.data.error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={fetcher.state !== "idle"} className={buttonClasses("primary", "sm")}>
          {fetcher.state !== "idle" ? "Sending…" : "Send request"}
        </button>
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={onDone}>Cancel</button>
        <span className="text-muted-foreground">Core reviews requests in the Infrastructure console.</span>
      </div>
    </form>
  );
}

function RequestHistory({ requests }: { requests: ProjectInfraRequest[] }) {
  return (
    <div className="rounded-lg border border-border">
      <p className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Requests
      </p>
      <ul className="divide-y divide-border">
        {requests.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
            <div>
              <span className="text-foreground">{r.kind.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground"> — {r.details}</span>
              {r.resolutionNote && <span className="block text-muted-foreground">Note: {r.resolutionNote}</span>}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                r.status === "Fulfilled"
                  ? "bg-green-100 text-green-800"
                  : r.status === "Rejected"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-800"
              }`}
              title={timeAgo(r.createdAt)}
            >
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
